import { config } from "dotenv";

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
- No inventes rutas. Usa exactamente la ruta indicada.
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

function userMessage(prompt: string, filePath: string, fileContent: string): string {
  return [
    `Prompt del usuario:`,
    prompt,
    ``,
    `ARCHIVO: ${filePath}`,
    ``,
    `Usa exactamente esa ruta en la cabecera de cada bloque. No la acortes ni la cambies.`,
    ``,
    `Contenido actual:`,
    fileContent,
  ].join("\n");
}

export async function proposeChanges(
  prompt: string,
  filePath: string,
  fileContent: string
): Promise<ProposeResult> {
  return chatCompletions([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage(prompt, filePath, fileContent) },
  ]);
}

export async function proposeCorrection(
  prompt: string,
  filePath: string,
  fileContent: string,
  previousText: string,
  correction: string = CORRECTION
): Promise<ProposeResult> {
  return chatCompletions([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage(prompt, filePath, fileContent) },
    { role: "assistant", content: previousText },
    { role: "user", content: correction },
  ]);
}
