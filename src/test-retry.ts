import {
  ABSOLUTE_MAX_RETRIES,
  DEFAULT_MAX_RETRIES,
  attemptLines,
  buildGateFeedback,
  formatLlmCalls,
  llmTotal,
  resolveMaxRetries,
  runBoundedRetry,
  sumTokens,
  truncateToolOutput,
  type RetryProposal,
} from "./retry.js";

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

function prop(tokensIn: number, tokensOut: number, text: string): RetryProposal {
  return { text, tokensIn, tokensOut };
}

// --- resolveMaxRetries ---
assert(resolveMaxRetries(undefined) === DEFAULT_MAX_RETRIES, "config: default sin variable");
assert(resolveMaxRetries("") === DEFAULT_MAX_RETRIES, "config: string vacio usa default");
assert(resolveMaxRetries("3") === 3, "config: parsea entero");
assert(resolveMaxRetries("99") === ABSOLUTE_MAX_RETRIES, "config: aplica tope absoluto");
assert(resolveMaxRetries("-4") === 0, "config: no admite negativos");
assert(resolveMaxRetries("abc") === DEFAULT_MAX_RETRIES, "config: no numerico usa default");
assert(resolveMaxRetries("2.9") === 2, "config: trunca decimales");
assert(resolveMaxRetries(4) === 4, "config: acepta numero directo");

// --- exito al primer intento ---
{
  const texts: string[] = [];
  const outcome = await runBoundedRetry<number>({
    maxRetries: 2,
    propose: async () => {
      texts.push("uno");
      return prop(10, 5, "uno");
    },
    gate: async () => ({ ok: true, value: 7 }),
  });
  assert(outcome.ok && outcome.value === 7, "exito: devuelve el valor de la puerta");
  assert(outcome.attempts.length === 1 && outcome.retries === 0, "exito: sin reintentos");
  assert(texts.length === 1, "exito: una sola propuesta");
  assert(outcome.attempts[0]?.status === "consolidated", "exito: intento marcado consolidado");
}

// --- reintenta SOLO si la puerta rechaza, con feedback ---
{
  const proposed: Array<{ hasFeedback: boolean; feedback?: string }> = [];
  let gateCalls = 0;
  const outcome = await runBoundedRetry<string>({
    maxRetries: 2,
    propose: async (fb) => {
      proposed.push(fb ? { hasFeedback: true, feedback: fb.message } : { hasFeedback: false });
      return prop(1, 1, `try-${proposed.length}`);
    },
    gate: async () => {
      gateCalls += 1;
      if (gateCalls === 1) {
        return {
          ok: false,
          rejection: {
            kind: "compile",
            reason: "fallo",
            output: "src/x.ts(1,1): error TS2322: Type 'x' is not assignable.",
          },
        };
      }
      return { ok: true, value: "done" };
    },
  });
  assert(outcome.ok && outcome.value === "done", "reintento: consolida el segundo intento");
  assert(proposed.length === 2, "reintento: exactamente dos propuestas");
  assert(proposed[0]?.hasFeedback === false, "reintento: la primera propuesta no lleva feedback");
  assert(proposed[1]?.hasFeedback === true, "reintento: la segunda lleva feedback");
  assert(proposed[1]?.feedback?.includes("TS2322") === true, "reintento: el feedback cita el error de tsc");
  assert(proposed[1]?.feedback?.includes("NO se consolido") === true, "reintento: avisa que el intento previo no se consolido");
  assert(outcome.attempts[0]?.status === "rejected" && outcome.attempts[1]?.status === "consolidated", "reintento: estados por intento");
}

// --- tope duro ---
{
  let proposeCount = 0;
  const outcome = await runBoundedRetry<number>({
    maxRetries: 2,
    propose: async () => {
      proposeCount += 1;
      return prop(1, 1, "x");
    },
    gate: async () => ({ ok: false, rejection: { kind: "compile", reason: "nope" } }),
  });
  assert(!outcome.ok, "tope: no consolida si la puerta siempre rechaza");
  assert(proposeCount === 3, "tope: 1 + maxRetries llamadas exactas");
  assert(outcome.attempts.length === 3 && outcome.retries === 2, "tope: 3 intentos y 2 reintentos");
  assert(!outcome.ok && outcome.lastRejection.kind === "compile", "tope: expone el ultimo rechazo");
}

// --- maxRetries = 0 ---
{
  let proposeCount = 0;
  const outcome = await runBoundedRetry<number>({
    maxRetries: 0,
    propose: async () => {
      proposeCount += 1;
      return prop(1, 1, "x");
    },
    gate: async () => ({ ok: false, rejection: { kind: "format", reason: "bad" } }),
  });
  assert(!outcome.ok && proposeCount === 1, "sin reintentos: una sola llamada");
  assert(outcome.retries === 0 && outcome.attempts.length === 1, "sin reintentos: contadores a cero");
}

// --- contabilidad de tokens por intento ---
{
  const proposals = [
    [10, 2],
    [20, 4],
    [30, 6],
  ];
  let i = 0;
  const outcome = await runBoundedRetry<number>({
    maxRetries: 2,
    propose: async () => {
      const pair = proposals[i] ?? [0, 0];
      i += 1;
      return prop(pair[0] ?? 0, pair[1] ?? 0, "x");
    },
    gate: async (_proposal, attemptIndex) =>
      attemptIndex < 3 ? { ok: false, rejection: { kind: "compile", reason: "x" } } : { ok: true, value: 1 },
  });
  assert(outcome.attempts[0]?.tokensIn === 10 && outcome.attempts[2]?.tokensOut === 6, "tokens: por intento");
  const totals = sumTokens(outcome.attempts);
  assert(totals.in === 60 && totals.out === 12 && totals.total === 72, "tokens: suma cuadra");
}

// --- truncado de salida ---
{
  const bigLines = Array.from({ length: 200 }, (_, k) => `src/f${k}.ts(1,1): error TS2322: bad ${k}`);
  const truncated = truncateToolOutput(bigLines.join("\n"));
  assert(truncated.includes("error TS2322"), "truncado: conserva lineas con error TS");
  assert(truncated.includes("salida truncada"), "truncado: marca el recorte");
  assert(truncated.length < bigLines.join("\n").length, "truncado: reduce el tamano");
  const errorLines = truncated.split("\n").filter((line) => line.includes("error TS"));
  assert(errorLines.length === 60, "truncado: respeta el maximo de lineas");
  assert(truncateToolOutput("") === "(sin output)", "truncado: salida vacia");

  const huge = `error TS9999: ${"x".repeat(9000)}`;
  const cut = truncateToolOutput(huge);
  assert(cut.length < 4100 && cut.includes("salida truncada"), "truncado: respeta el maximo de caracteres");
}

// --- feedback ---
{
  const fb = buildGateFeedback({
    kind: "compile",
    reason: "x",
    output: "src/a.ts(2,3): error TS1234: nope",
  });
  assert(fb.includes("NO se consolido"), "feedback: compilacion avisa que no se consolido");
  assert(fb.includes("TS1234"), "feedback: compilacion incluye el error");
  assert(buildGateFeedback({ kind: "materialization", reason: "r" }).includes("materializar"), "feedback: materializacion");
  assert(buildGateFeedback({ kind: "path", reason: "r" }).includes("objetivo"), "feedback: ruta");
  assert(buildGateFeedback({ kind: "format", reason: "r" }).includes("bloques"), "feedback: formato");
}

// --- contabilidad de llamadas ---
{
  const calls = { selector: 1, proposal: 1, retries: 2, audit: 1 };
  assert(llmTotal(calls) === 5, "llamadas: total suma los componentes");
  const line = formatLlmCalls(calls);
  assert(line.includes("Llamadas LLM: 5"), "llamadas: titulo con total");
  assert(
    line.includes("selector 1") && line.includes("propuesta 1") && line.includes("reintentos 2") && line.includes("auditoria 1"),
    "llamadas: desglose completo"
  );
  assert(
    formatLlmCalls({ selector: 0, proposal: 1, retries: 0, audit: 0 }) === "Llamadas LLM: 1 (propuesta 1)",
    "llamadas: omite componentes en cero"
  );
}

// --- lineas por intento ---
{
  const lines = attemptLines([
    { index: 1, tokensIn: 10, tokensOut: 5, status: "rejected", rejection: { kind: "compile", reason: "x" } },
    { index: 2, tokensIn: 8, tokensOut: 4, status: "consolidated" },
  ]);
  assert(lines.length === 2, "intentos: una linea por intento");
  assert(lines[0]?.includes("Intento 1") && lines[0]?.includes("tsc"), "intentos: describe el rechazo de la puerta");
  assert(lines[1]?.includes("consolidado"), "intentos: describe el exito");
}

console.log("");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
