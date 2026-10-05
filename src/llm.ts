import { config } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildContext } from "./context.js";

config();

export interface ProposeResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  escalated: boolean;
}

export interface CallLimits {
  maxTokens: number;
  emergencyMaxTokens: number;
}

export const DEFAULT_MAX_TOKENS_SELECTOR = 500;
export const ABSOLUTE_MAX_TOKENS_SELECTOR = 4000;
export const DEFAULT_MAX_TOKENS_PROPOSER = 4096;
export const ABSOLUTE_MAX_TOKENS_PROPOSER = 16384;
export const DEFAULT_MAX_TOKENS_AUDIT = 500;
export const ABSOLUTE_MAX_TOKENS_AUDIT = 2000;

export function resolveMaxTokens(
  configured: string | number | undefined,
  fallback: number,
  absolute: number
): number {
  const clamp = (value: number): number => Math.max(1, Math.min(absolute, Math.trunc(value)));
  if (typeof configured === "number") {
    return Number.isFinite(configured) && configured > 0 ? clamp(configured) : fallback;
  }
  const raw = (configured ?? "").trim();
  if (raw.length === 0) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return clamp(parsed);
}

export function resolveCallLimits(
  configured: string | number | undefined,
  fallback: number,
  absolute: number
): CallLimits {
  const maxTokens = resolveMaxTokens(configured, fallback, absolute);
  const emergencyMaxTokens = Math.min(absolute, Math.max(fallback, maxTokens * 4));
  return { maxTokens, emergencyMaxTokens };
}

const SELECTOR_LIMITS: CallLimits = resolveCallLimits(
  undefined,
  DEFAULT_MAX_TOKENS_SELECTOR,
  ABSOLUTE_MAX_TOKENS_SELECTOR
);
const PROPOSER_LIMITS: CallLimits = resolveCallLimits(
  undefined,
  DEFAULT_MAX_TOKENS_PROPOSER,
  ABSOLUTE_MAX_TOKENS_PROPOSER
);
const AUDIT_LIMITS: CallLimits = resolveCallLimits(undefined, DEFAULT_MAX_TOKENS_AUDIT, ABSOLUTE_MAX_TOKENS_AUDIT);

const MAX_TOKENS_ENV: Record<string, string> = {
  selector: "D_ENGINE_MAX_TOKENS_SELECTOR",
  proposer: "D_ENGINE_MAX_TOKENS_PROPOSER",
  audit: "D_ENGINE_MAX_TOKENS_AUDIT",
};

let truncationEscalations = 0;

export function getTruncationEscalations(): number {
  return truncationEscalations;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `Eres un editor de codigo determinista. Responde UNICAMENTE con bloques SEARCH/REPLACE (editar archivos existentes) o bloques NEW FILE (crear archivos nuevos). Prohibido cualquier explicacion, comentario, saludo o markdown fuera de los bloques.

Formato SEARCH/REPLACE (archivo existente, diff-fenced):

\`\`\`diff ruta/al/archivo.ext
<<<<<<< SEARCH
codigo existente copiado con exactitud de caracteres
=======
codigo de reemplazo
>>>>>>> REPLACE
\`\`\`

Formato NEW FILE (archivo nuevo):

NEW FILE: ruta/al/archivo.ext
<<<EOF
contenido completo del archivo
EOF

Reglas:
- Usa NEW FILE SOLO si el archivo NO existe todavia. Si existe, usa SEARCH/REPLACE.
- En NEW FILE, tras "NEW FILE:" escribe la ruta; la siguiente linea debe ser exactamente <<<EOF; escribe el contenido COMPLETO; cierra con una linea que sea exactamente EOF. No uses una linea EOF dentro del contenido.
- No envuelvas el contenido de NEW FILE en fences de markdown ni anadas texto despues de EOF.
- SEARCH debe copiar el codigo existente con exactitud de caracteres: espacios, indentacion y saltos de linea identicos al archivo.
- SEARCH debe ser un fragmento unico en el archivo.
- No inventes rutas. Usa exactamente las rutas de archivo objetivo indicadas.
- Puedes responder con bloques para uno o varios de esos archivos.
- Si hay varios cambios, emite varios bloques. Nada mas.`;

const CORRECTION =
  "tu respuesta no contenía bloques SEARCH/REPLACE ni NEW FILE válidos; responde solo con bloques";

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. Copia .env.example a .env y rellena LLM_BASE_URL, LLM_API_KEY y LLM_MODEL.`
    );
  }
  return value;
}

function chatUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

function llmLog(tokensIn: number, tokensOut: number, label?: string): void {
  const total = tokensIn + tokensOut;
  const tag = label ? ` ${label}` : "";
  console.log(`[d-engine:llm]${tag} prompt=${tokensIn} completion=${tokensOut} total=${total}`);
}

interface ChatOptions {
  label?: string;
  limits: CallLimits;
  call: string;
}

interface ChatResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
  finishReason: string | null;
}

function truncatedError(call: string, maxTokens: number): Error {
  const variable = MAX_TOKENS_ENV[call] ?? "D_ENGINE_MAX_TOKENS_*";
  return new Error(
    `El LLM trunco la respuesta (finish_reason=length) con max_tokens=${maxTokens} en la llamada ${call}. Sube ${variable} o reduce el contexto.`
  );
}

async function requestChat(messages: ChatMessage[], options: ChatOptions, maxTokens: number): Promise<ChatResponse> {
  const base = env("LLM_BASE_URL");
  const apiKey = env("LLM_API_KEY");
  const model = env("LLM_MODEL");
  const url = chatUrl(base);

  const payload = {
    model,
    messages,
    max_tokens: maxTokens,
    thinking: { type: "disabled" as const },
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo contactar el LLM en ${url}: ${detail}`);
  }

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`El LLM respondio HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }

  let data: {
    choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error("El LLM devolvio una respuesta que no es JSON valido.");
  }

  const text = data.choices?.[0]?.message?.content ?? "";
  const finishReason = data.choices?.[0]?.finish_reason ?? null;
  const tokensIn = data.usage?.prompt_tokens ?? 0;
  const tokensOut = data.usage?.completion_tokens ?? 0;
  if (options.label !== undefined) llmLog(tokensIn, tokensOut, options.label);
  else llmLog(tokensIn, tokensOut);
  return { text, tokensIn, tokensOut, finishReason };
}

async function chatCompletions(messages: ChatMessage[], options: ChatOptions): Promise<ProposeResult> {
  const primary = await requestChat(messages, options, options.limits.maxTokens);
  if (primary.finishReason !== "length") {
    return { text: primary.text, tokensIn: primary.tokensIn, tokensOut: primary.tokensOut, escalated: false };
  }

  const emergency = options.limits.emergencyMaxTokens;
  if (!(emergency > options.limits.maxTokens)) {
    throw truncatedError(options.call, options.limits.maxTokens);
  }

  truncationEscalations += 1;
  console.log(
    `[d-engine:llm] ${options.call} TRUNCADO (finish_reason=length, max_tokens=${options.limits.maxTokens}): escalando a max_tokens=${emergency}`
  );
  const escalated = await requestChat(messages, options, emergency);
  if (escalated.finishReason === "length") {
    throw truncatedError(options.call, emergency);
  }
  return { text: escalated.text, tokensIn: escalated.tokensIn, tokensOut: escalated.tokensOut, escalated: true };
}

export const SELECTOR_SYSTEM = `Eres un selector de archivos. Responde UNICAMENTE un JSON array de strings con rutas posix del catalogo. Ejemplo: ["src/engine.ts"]. Prohibido markdown, explicaciones o rutas fuera de la lista. Elige el MINIMO conjunto necesario: los archivos a modificar Y, si el prompt pide actualizar usos, los que importen o usen esos simbolos. No incluyas archivos por si acaso.`;

function selectorUser(prompt: string, catalogText: string): string {
  return [`Prompt del usuario:`, prompt, ``, `Catalogo:`, catalogText].join("\n");
}

export async function selectTargetFiles(
  prompt: string,
  catalogText: string,
  retry?: { previousText: string; feedback: string },
  limits: CallLimits = SELECTOR_LIMITS
): Promise<ProposeResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: SELECTOR_SYSTEM },
    { role: "user", content: selectorUser(prompt, catalogText) },
  ];
  if (retry) {
    messages.push({ role: "assistant", content: retry.previousText });
    messages.push({ role: "user", content: retry.feedback });
  }
  return chatCompletions(messages, { label: "selector", call: "selector", limits });
}

function userMessage(prompt: string, filePaths: string[], context: string): string {
  const listed = filePaths.flatMap((filePath) => {
    const abs = path.resolve(process.cwd(), filePath);
    if (existsSync(abs)) {
      return [`ARCHIVO: ${filePath}`, ``, readFileSync(abs, "utf8"), ``];
    }
    return [
      `ARCHIVO NUEVO (no existe todavia): ${filePath}`,
      ``,
      `Debes crearlo con un bloque NEW FILE: ${filePath}`,
      ``,
    ];
  });
  return [
    `Prompt del usuario:`,
    prompt,
    ``,
    ...listed,
    `Usa exactamente esas rutas. Para cada ARCHIVO NUEVO emite un bloque NEW FILE; para cada ARCHIVO existente emite SEARCH/REPLACE. No las acortes ni las cambies.`,
    ``,
    `Contexto:`,
    context,
  ].join("\n");
}

export async function proposeChanges(
  prompt: string,
  filePaths: string[],
  limits: CallLimits = PROPOSER_LIMITS
): Promise<ProposeResult> {
  const context = await buildContext(filePaths);
  return chatCompletions(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage(prompt, filePaths, context) },
    ],
    { call: "proposer", limits }
  );
}

const VERIFY_SYSTEM = `Eres un auditor semantico. Recibes un REQUISITO y un DIFF. Responde con exactamente una linea, sin markdown:

- OK — el diff cumple el requisito explicito del usuario.
- OK_CON_OBSERVACIONES: <notas> — el requisito se cumple; hay detalles menores de estilo, nombres de tags o convenciones. Eso NO es FALLO.
- FALLO: <motivo> — UNICAMENTE si el diff no cumple una parte explicita del requisito o introduce un comportamiento incorrecto.

No rechaces por estilo, nombres de tags ni convenciones. Esos casos son OK_CON_OBSERVACIONES, nunca FALLO.`;

export async function verifyChanges(
  prompt: string,
  diff: string,
  limits: CallLimits = AUDIT_LIMITS
): Promise<ProposeResult> {
  return chatCompletions(
    [
      { role: "system", content: VERIFY_SYSTEM },
      {
        role: "user",
        content: [`REQUISITO:`, prompt, ``, `DIFF:`, diff.trim().length > 0 ? diff : "(sin cambios)"].join("\n"),
      },
    ],
    { call: "audit", limits }
  );
}

function stripVerdictRest(trimmed: string, prefix: string): string {
  return trimmed.slice(prefix.length).replace(/^[\s:.\-—–]+/, "").trim();
}

export function parseVerifyVerdict(text: string): { ok: boolean; reason: string } {
  const trimmed = text.trim();
  const head = trimmed.toUpperCase();
  if (head.startsWith("FALLO")) {
    const reason = stripVerdictRest(trimmed, "FALLO");
    return { ok: false, reason: reason || "auditoria rechazada" };
  }
  if (head.startsWith("OK_CON_OBSERVACIONES")) {
    return { ok: true, reason: stripVerdictRest(trimmed, "OK_CON_OBSERVACIONES") };
  }
  if (head.startsWith("OK")) {
    return { ok: true, reason: "" };
  }
  console.log(`[d-engine] veredicto de auditoria con formato desconocido. Respuesta cruda:\n${text}`);
  return { ok: false, reason: trimmed || "auditoria rechazada" };
}

export async function proposeCorrection(
  prompt: string,
  filePaths: string[],
  previousText: string,
  correction: string = CORRECTION,
  limits: CallLimits = PROPOSER_LIMITS
): Promise<ProposeResult> {
  const context = await buildContext(filePaths);
  return chatCompletions(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage(prompt, filePaths, context) },
      { role: "assistant", content: previousText },
      { role: "user", content: correction },
    ],
    { call: "proposer", limits }
  );
}
