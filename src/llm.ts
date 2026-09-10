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

function llmLog(tokensIn: number, tokensOut: number): void {
  const total = tokensIn + tokensOut;
  console.log(`[d-engine:llm] prompt=${tokensIn} completion=${tokensOut} total=${total}`);
}

async function chatCompletions(messages: ChatMessage[]): Promise<ProposeResult> {
  const base = env("LLM_BASE_URL");
  const apiKey = env("LLM_API_KEY");
  const model = env("LLM_MODEL");
  const url = chatUrl(base);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages }),
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
  llmLog(tokensIn, tokensOut);
  return { text, tokensIn, tokensOut };
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

export function parseVerifyVerdict(text: string): { ok: boolean; reason: string } {
  const line = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const fallo = /^FALLO:\s*(.*)$/i.exec(line);
  if (fallo) {
    return { ok: false, reason: (fallo[1] ?? "").trim() || "auditoria rechazada" };
  }
  const notes = /^OK_CON_OBSERVACIONES:\s*(.*)$/i.exec(line);
  if (notes) {
    return { ok: true, reason: (notes[1] ?? "").trim() };
  }
  if (/^OK\s*$/i.test(line)) {
    return { ok: true, reason: "" };
  }
  return { ok: false, reason: line || "auditoria rechazada" };
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
