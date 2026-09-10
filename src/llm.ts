import { config } from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildContext } from "./context.js";

config();

export interface ProposeResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `Eres un editor de codigo determinista. Responde UNICAMENTE con uno o mas bloques SEARCH/REPLACE en formato diff-fenced. Prohibido cualquier explicacion, comentario, saludo o markdown fuera de los bloques.

Formato obligatorio (diff-fenced):

\`\`\`diff ruta/al/archivo.ext
<<<<<<< SEARCH
codigo existente copiado con exactitud de caracteres
=======
codigo de reemplazo
>>>>>>> REPLACE
\`\`\`

Reglas:
- SEARCH debe copiar el codigo existente con exactitud de caracteres: espacios, indentacion y saltos de linea identicos al archivo.
- SEARCH debe ser un fragmento unico en el archivo.
- No inventes rutas. Usa exactamente las rutas de archivo objetivo indicadas.
- Puedes responder con bloques para uno o varios de esos archivos.
- Si hay varios cambios, emite varios bloques. Nada mas.`;

const CORRECTION =
  "tu respuesta no contenía bloques SEARCH/REPLACE válidos; responde solo con bloques";

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
  maxTokens?: number;
}

async function chatCompletions(messages: ChatMessage[], options: ChatOptions = {}): Promise<ProposeResult> {
  const base = env("LLM_BASE_URL");
  const apiKey = env("LLM_API_KEY");
  const model = env("LLM_MODEL");
  const url = chatUrl(base);

  const payload: { model: string; messages: ChatMessage[]; max_tokens?: number } = { model, messages };
  if (options.maxTokens !== undefined) payload.max_tokens = options.maxTokens;

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
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error("El LLM devolvio una respuesta que no es JSON valido.");
  }

  const text = data.choices?.[0]?.message?.content ?? "";
  const tokensIn = data.usage?.prompt_tokens ?? 0;
  const tokensOut = data.usage?.completion_tokens ?? 0;
  if (options.label !== undefined) llmLog(tokensIn, tokensOut, options.label);
  else llmLog(tokensIn, tokensOut);
  return { text, tokensIn, tokensOut };
}

const SELECTOR_SYSTEM = `Eres un selector de archivos. Responde UNICAMENTE un JSON array de strings con rutas posix del catalogo. Ejemplo: ["src/engine.ts"]. Prohibido markdown, explicaciones o rutas fuera de la lista.`;

function selectorUser(prompt: string, catalogText: string): string {
  return [`Prompt del usuario:`, prompt, ``, `Catalogo:`, catalogText].join("\n");
}

export async function selectTargetFiles(
  prompt: string,
  catalogText: string,
  retry?: { previousText: string; feedback: string }
): Promise<ProposeResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: SELECTOR_SYSTEM },
    { role: "user", content: selectorUser(prompt, catalogText) },
  ];
  if (retry) {
    messages.push({ role: "assistant", content: retry.previousText });
    messages.push({ role: "user", content: retry.feedback });
  }
  return chatCompletions(messages, { label: "selector", maxTokens: 200 });
}

function userMessage(prompt: string, filePaths: string[], context: string): string {
  const listed = filePaths.flatMap((filePath) => [
    `ARCHIVO: ${filePath}`,
    ``,
    readFileSync(path.resolve(process.cwd(), filePath), "utf8"),
    ``,
  ]);
  return [
    `Prompt del usuario:`,
    prompt,
    ``,
    ...listed,
    `Usa exactamente esas rutas en la cabecera de cada bloque. Puedes emitir bloques para uno o varios de esos archivos. No las acortes ni las cambies.`,
    ``,
    `Contexto:`,
    context,
  ].join("\n");
}

export async function proposeChanges(prompt: string, filePaths: string[]): Promise<ProposeResult> {
  const context = await buildContext(filePaths);
  return chatCompletions([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage(prompt, filePaths, context) },
  ]);
}

const VERIFY_SYSTEM = `Eres un auditor semantico. Recibes un REQUISITO y un DIFF. Responde con exactamente una linea, sin markdown:

- OK — el diff cumple el requisito explicito del usuario.
- OK_CON_OBSERVACIONES: <notas> — el requisito se cumple; hay detalles menores de estilo, nombres de tags o convenciones. Eso NO es FALLO.
- FALLO: <motivo> — UNICAMENTE si el diff no cumple una parte explicita del requisito o introduce un comportamiento incorrecto.

No rechaces por estilo, nombres de tags ni convenciones. Esos casos son OK_CON_OBSERVACIONES, nunca FALLO.`;

export async function verifyChanges(prompt: string, diff: string): Promise<ProposeResult> {
  return chatCompletions([
    { role: "system", content: VERIFY_SYSTEM },
    {
      role: "user",
      content: [`REQUISITO:`, prompt, ``, `DIFF:`, diff.trim().length > 0 ? diff : "(sin cambios)"].join("\n"),
    },
  ]);
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
  correction: string = CORRECTION
): Promise<ProposeResult> {
  const context = await buildContext(filePaths);
  return chatCompletions([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage(prompt, filePaths, context) },
    { role: "assistant", content: previousText },
    { role: "user", content: correction },
  ]);
}
