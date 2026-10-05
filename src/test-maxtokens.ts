import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ABSOLUTE_MAX_TOKENS_AUDIT,
  ABSOLUTE_MAX_TOKENS_PROPOSER,
  ABSOLUTE_MAX_TOKENS_SELECTOR,
  DEFAULT_MAX_TOKENS_AUDIT,
  DEFAULT_MAX_TOKENS_PROPOSER,
  DEFAULT_MAX_TOKENS_SELECTOR,
  getTruncationEscalations,
  proposeChanges,
  proposeCorrection,
  resolveCallLimits,
  resolveMaxTokens,
  selectTargetFiles,
  verifyChanges,
} from "./llm.js";
import { truncationEscalationLine } from "./telemetry.js";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failed += 1;
    console.error(`FAIL  ${msg}`);
    return;
  }
  passed += 1;
  console.log(`PASS  ${msg}`);
}

interface MockReply {
  content: string;
  finishReason: string | null;
  prompt: number;
  completion: number;
}

const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
const queue: MockReply[] = [];
const originalFetch = globalThis.fetch;

function reply(content: string, finishReason: string | null = "stop", prompt = 1, completion = 1): MockReply {
  return { content, finishReason, prompt, completion };
}

function installFetch(replies: MockReply[]): void {
  queue.length = 0;
  calls.length = 0;
  queue.push(...replies);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ url: String(input), body });
    const next = queue.shift();
    if (!next) throw new Error("fetch mock: no quedan respuestas");
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: next.content }, finish_reason: next.finishReason }],
        usage: { prompt_tokens: next.prompt, completion_tokens: next.completion },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

function maxTokensOf(index: number): unknown {
  return calls[index]?.body.max_tokens;
}

async function rejectsWith(fn: () => Promise<unknown>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

process.env.LLM_BASE_URL = "https://mock.local/v1";
process.env.LLM_API_KEY = "test-key";
process.env.LLM_MODEL = "mock-model";

// --- resolveMaxTokens: default, parseo, tope y basura ---
assert(
  resolveMaxTokens(undefined, DEFAULT_MAX_TOKENS_SELECTOR, ABSOLUTE_MAX_TOKENS_SELECTOR) ===
    DEFAULT_MAX_TOKENS_SELECTOR,
  "resolver: undefined usa el default"
);
assert(
  resolveMaxTokens("", DEFAULT_MAX_TOKENS_SELECTOR, ABSOLUTE_MAX_TOKENS_SELECTOR) === DEFAULT_MAX_TOKENS_SELECTOR,
  "resolver: cadena vacia usa el default"
);
assert(
  resolveMaxTokens("1000", DEFAULT_MAX_TOKENS_SELECTOR, ABSOLUTE_MAX_TOKENS_SELECTOR) === 1000,
  "resolver: parsea entero"
);
assert(
  resolveMaxTokens("999999", DEFAULT_MAX_TOKENS_PROPOSER, ABSOLUTE_MAX_TOKENS_PROPOSER) ===
    ABSOLUTE_MAX_TOKENS_PROPOSER,
  "resolver: aplica tope absoluto"
);
assert(
  resolveMaxTokens("abc", DEFAULT_MAX_TOKENS_PROPOSER, ABSOLUTE_MAX_TOKENS_PROPOSER) ===
    DEFAULT_MAX_TOKENS_PROPOSER,
  "resolver: no numerico usa default"
);
assert(
  resolveMaxTokens("0", DEFAULT_MAX_TOKENS_PROPOSER, ABSOLUTE_MAX_TOKENS_PROPOSER) ===
    DEFAULT_MAX_TOKENS_PROPOSER,
  "resolver: 0 usa default (no existe OFF)"
);
assert(
  resolveMaxTokens("-5", DEFAULT_MAX_TOKENS_PROPOSER, ABSOLUTE_MAX_TOKENS_PROPOSER) ===
    DEFAULT_MAX_TOKENS_PROPOSER,
  "resolver: negativo usa default"
);
assert(
  resolveMaxTokens("2.9", DEFAULT_MAX_TOKENS_PROPOSER, ABSOLUTE_MAX_TOKENS_PROPOSER) === 2,
  "resolver: trunca decimales"
);
assert(
  resolveMaxTokens(4000, DEFAULT_MAX_TOKENS_SELECTOR, ABSOLUTE_MAX_TOKENS_SELECTOR) === 4000,
  "resolver: acepta numero directo"
);
assert(
  resolveMaxTokens(0, DEFAULT_MAX_TOKENS_SELECTOR, ABSOLUTE_MAX_TOKENS_SELECTOR) === DEFAULT_MAX_TOKENS_SELECTOR,
  "resolver: numero 0 usa default"
);

// --- resolveCallLimits: techo de emergencia ---
{
  const sel = resolveCallLimits(undefined, DEFAULT_MAX_TOKENS_SELECTOR, ABSOLUTE_MAX_TOKENS_SELECTOR);
  assert(
    sel.maxTokens === 500 && sel.emergencyMaxTokens === 2000,
    "emergencia: selector 500 -> 2000"
  );
  const prop = resolveCallLimits(undefined, DEFAULT_MAX_TOKENS_PROPOSER, ABSOLUTE_MAX_TOKENS_PROPOSER);
  assert(
    prop.maxTokens === 4096 && prop.emergencyMaxTokens === 16384,
    "emergencia: proposer 4096 -> 16384 (tope absoluto)"
  );
  const audit = resolveCallLimits(undefined, DEFAULT_MAX_TOKENS_AUDIT, ABSOLUTE_MAX_TOKENS_AUDIT);
  assert(
    audit.maxTokens === 500 && audit.emergencyMaxTokens === 2000,
    "emergencia: auditoria 500 -> 2000"
  );
  const tiny = resolveCallLimits("20", DEFAULT_MAX_TOKENS_PROPOSER, ABSOLUTE_MAX_TOKENS_PROPOSER);
  assert(
    tiny.maxTokens === 20 && tiny.emergencyMaxTokens === DEFAULT_MAX_TOKENS_PROPOSER,
    "emergencia: valor minusculo tiene suelo en el default"
  );
  const huge = resolveCallLimits("999999", DEFAULT_MAX_TOKENS_PROPOSER, ABSOLUTE_MAX_TOKENS_PROPOSER);
  assert(
    huge.maxTokens === ABSOLUTE_MAX_TOKENS_PROPOSER &&
      huge.emergencyMaxTokens === ABSOLUTE_MAX_TOKENS_PROPOSER,
    "emergencia: config maxima se queda en el tope absoluto (sin escalada)"
  );
}

// --- cada tipo de llamada declara su max_tokens (fetch mockeado) ---
{
  installFetch([reply('["src/a.ts"]')]);
  const result = await selectTargetFiles("prompt", "catalogo");
  assert(result.escalated === false, "selector: respuesta normal no escala");
  assert(calls.length === 1, "selector: una sola peticion");
  assert(maxTokensOf(0) === DEFAULT_MAX_TOKENS_SELECTOR, "selector: envia su techo por defecto");
  assert(
    calls[0]?.body.messages !== undefined && calls[0]?.body.thinking !== undefined,
    "selector: cuerpo de peticion completo"
  );
}

{
  const limits = { maxTokens: 100, emergencyMaxTokens: 400 };
  installFetch([reply('cortado', "length"), reply('["src/a.ts"]')]);
  const before = getTruncationEscalations();
  const result = await selectTargetFiles("prompt", "catalogo", undefined, limits);
  assert(calls.length === 2, "selector truncado: exactamente dos peticiones (una escalada)");
  assert(maxTokensOf(0) === 100, "selector truncado: primer intento con techo base");
  assert(maxTokensOf(1) === 400, "selector truncado: escalada con techo ampliado");
  assert(result.escalated === true, "selector truncado: marca escalated");
  assert(result.text === '["src/a.ts"]', "selector truncado: usa la respuesta escalada");
  assert(getTruncationEscalations() === before + 1, "contador compartido: registra la escalada");
}

// --- proposer / auditoria necesitan cwd de prueba para buildContext ---
const tmp = mkdtempSync(path.join(os.tmpdir(), "d-engine-maxtokens-"));
mkdirSync(path.join(tmp, "src"), { recursive: true });
writeFileSync(path.join(tmp, "src", "a.ts"), "export const a = 1;\n");
const originalCwd = process.cwd();
process.chdir(tmp);

try {
  {
    installFetch([reply("SEARCH/REPLACE")]);
    const result = await proposeChanges("prompt", ["src/a.ts"]);
    assert(result.escalated === false, "proposer: respuesta normal no escala");
    assert(calls.length === 1, "proposer: una sola peticion");
    assert(maxTokensOf(0) === DEFAULT_MAX_TOKENS_PROPOSER, "proposer: envia su techo por defecto");
  }

  {
    const limits = { maxTokens: 50, emergencyMaxTokens: 200 };
    installFetch([reply("cortado", "length"), reply("SEARCH/REPLACE completo")]);
    const result = await proposeCorrection("prompt", ["src/a.ts"], "anterior", "corrige", limits);
    assert(calls.length === 2, "proposer correccion truncada: dos peticiones (una escalada)");
    assert(maxTokensOf(0) === 50 && maxTokensOf(1) === 200, "proposer correccion: techos base y emergencia");
    assert(result.escalated === true && result.text === "SEARCH/REPLACE completo", "proposer correccion: usa la escalada");
  }

  {
    installFetch([reply("OK")]);
    const result = await verifyChanges("requisito", "diff");
    assert(result.escalated === false, "auditoria: respuesta normal no escala");
    assert(calls.length === 1, "auditoria: una sola peticion");
    assert(maxTokensOf(0) === DEFAULT_MAX_TOKENS_AUDIT, "auditoria: envia su techo por defecto");
  }
} finally {
  process.chdir(originalCwd);
}

// --- finish_reason=length: deteccion y fallo claro si la emergencia tambien trunca ---
{
  const limits = { maxTokens: 50, emergencyMaxTokens: 200 };
  installFetch([reply("corta", "length"), reply("corta tambien", "length")]);
  const before = getTruncationEscalations();
  const error = await rejectsWith(() => selectTargetFiles("prompt", "catalogo", undefined, limits));
  assert(error !== null, "doble truncado: lanza error");
  assert(error?.message.includes("finish_reason=length") === true, "doble truncado: cita finish_reason=length");
  assert(error?.message.includes("D_ENGINE_MAX_TOKENS_SELECTOR") === true, "doble truncado: nombra la variable del selector");
  assert(calls.length === 2, "doble truncado: no encadena mas de una escalada");
  assert(
    getTruncationEscalations() === before + 1,
    "contador compartido: cuenta la escalada aunque la llamada falle"
  );
}

{
  installFetch([reply("corta", "length"), reply("corta tambien", "length")]);
  const limits = { maxTokens: 50, emergencyMaxTokens: 200 };
  const error = await rejectsWith(() => proposeCorrection("prompt", ["src/inexistente.ts"], "anterior", "corrige", limits));
  assert(error?.message.includes("D_ENGINE_MAX_TOKENS_PROPOSER") === true, "doble truncado: la variable del proposer aparece");
  assert(calls.length === 2, "doble truncado proposer: solo una escalada");
}

{
  installFetch([reply("corta", "length"), reply("corta tambien", "length")]);
  const error = await rejectsWith(() => verifyChanges("requisito", "diff", { maxTokens: 50, emergencyMaxTokens: 200 }));
  assert(error?.message.includes("D_ENGINE_MAX_TOKENS_AUDIT") === true, "doble truncado: la variable de auditoria aparece");
}

// --- sin ampliacion posible (base == absoluto): falla sin reintentar ---
{
  const limits = { maxTokens: 300, emergencyMaxTokens: 300 };
  installFetch([reply("corta", "length")]);
  const error = await rejectsWith(() => selectTargetFiles("prompt", "catalogo", undefined, limits));
  assert(error !== null && calls.length === 1, "tope absoluto alcanzado: falla en el primer intento sin escalar");
}

// --- finish_reason distinto de length no marca truncado ---
{
  installFetch([reply("contenido", "stop")]);
  const result = await verifyChanges("requisito", "diff");
  assert(result.escalated === false && calls.length === 1, "finish_reason=stop: ni trunca ni escala");
}

// --- linea de resumen ---
assert(truncationEscalationLine(0) === "Escaladas por truncado: 0", "telemetria: linea con cero");
assert(truncationEscalationLine(2) === "Escaladas por truncado: 2", "telemetria: linea con valor");

restoreFetch();

console.log("");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
