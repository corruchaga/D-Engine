import { emptyMergeOutcome, hasFuzzyPatch, parseNameStatus, type ApplyResult } from "./engine.js";
import {
  attemptLines,
  buildGateFeedback,
  rejectionLabel,
  resolveFuzzyVerify,
  runBoundedRetry,
} from "./retry.js";
import { createPhaseTimings, timingLines } from "./telemetry.js";

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

// --- resolveFuzzyVerify ---
assert(resolveFuzzyVerify(undefined) === true, "fuzzy-verify: default (undefined) es ON");
assert(resolveFuzzyVerify("") === true, "fuzzy-verify: cadena vacia es ON");
assert(resolveFuzzyVerify("1") === true, "fuzzy-verify: 1 es ON");
assert(resolveFuzzyVerify("true") === true, "fuzzy-verify: true es ON");
assert(resolveFuzzyVerify("0") === false, "fuzzy-verify: 0 es OFF");
assert(resolveFuzzyVerify("false") === false, "fuzzy-verify: false es OFF");
assert(resolveFuzzyVerify("FALSE") === false, "fuzzy-verify: FALSE (case-insensitive) es OFF");
assert(resolveFuzzyVerify("off") === false, "fuzzy-verify: off es OFF");

// --- hasFuzzyPatch ---
const exactOnly: ApplyResult[] = [
  { filePath: "src/a.ts", strategy: "exact" },
  { filePath: "src/b.ts", strategy: "new-file" },
];
const mixed: ApplyResult[] = [
  { filePath: "src/a.ts", strategy: "exact" },
  { filePath: "src/b.ts", strategy: "fuzzy" },
];
assert(hasFuzzyPatch(exactOnly) === false, "hasFuzzyPatch: exact/new-file no dispara");
assert(hasFuzzyPatch(mixed) === true, "hasFuzzyPatch: un fuzzy dispara");
assert(hasFuzzyPatch([]) === false, "hasFuzzyPatch: vacio no dispara");

// --- MergeOutcome vacio ---
{
  const empty = emptyMergeOutcome();
  assert(
    empty.merged === false && empty.created.length === 0 && empty.edited.length === 0,
    "merge-outcome: vacio por defecto"
  );
}

// --- parseNameStatus ---
{
  const parsed = parseNameStatus("A\tsrc/new.ts\nM\tsrc/utils.ts\n\n");
  assert(parsed.length === 2, "name-status: una entrada por linea con contenido");
  assert(parsed[0]?.status === "A" && parsed[0]?.path === "src/new.ts", "name-status: creado A");
  assert(parsed[1]?.status === "M" && parsed[1]?.path === "src/utils.ts", "name-status: editado M");
  const win = parseNameStatus("A\tsrc\\nested\\file.ts\n");
  assert(win[0]?.path === "src/nested/file.ts", "name-status: normaliza backslashes");
  assert(parseNameStatus("").length === 0, "name-status: salida vacia");
}

// --- feedback del rechazo audit ---
{
  const fb = buildGateFeedback({ kind: "audit", reason: "la guarda se aplica al precio final" });
  assert(fb.includes("NO se consolido"), "feedback audit: avisa que no se consolido");
  assert(fb.includes("la guarda se aplica al precio final"), "feedback audit: cita el motivo");
  const bigReason = Array.from({ length: 200 }, (_, k) => `error TS0000: motivo ${k}`).join("\n");
  const cut = buildGateFeedback({ kind: "audit", reason: bigReason });
  assert(cut.includes("salida truncada"), "feedback audit: trunca motivos gigantes");
  assert(cut.length < 4200, "feedback audit: respeta el limite de caracteres");
}

// --- etiquetas ---
{
  assert(rejectionLabel("audit").includes("auditoria"), "rejectionLabel: audit menciona auditoria");
  const lines = attemptLines([
    { index: 1, tokensIn: 10, tokensOut: 2, status: "rejected", rejection: { kind: "audit", reason: "x" } },
    { index: 2, tokensIn: 8, tokensOut: 1, status: "consolidated" },
  ]);
  assert(lines[0]?.includes("auditoria") === true, "attemptLines: pinta el rechazo audit");
}

// --- cota: el rechazo audit consume un intento del 1+N ---
{
  const feedbacks: string[] = [];
  let gateCalls = 0;
  const outcome = await runBoundedRetry<string>({
    maxRetries: 2,
    propose: async (fb) => {
      if (fb) feedbacks.push(fb.message);
      return { text: "propuesta", tokensIn: 1, tokensOut: 1 };
    },
    gate: async () => {
      gateCalls += 1;
      if (gateCalls === 1) {
        return { ok: false, rejection: { kind: "audit", reason: "el diff invierte la condicion" } };
      }
      return { ok: true, value: "consolidado" };
    },
  });
  assert(outcome.ok && outcome.value === "consolidado", "cota audit: consolida el reintento");
  assert(outcome.attempts.length === 2 && outcome.retries === 1, "cota audit: 2 intentos, 1 reintento");
  assert(outcome.attempts[0]?.rejection?.kind === "audit", "cota audit: el primer intento queda como audit");
  assert(feedbacks[0]?.includes("el diff invierte la condicion") === true, "cota audit: el motivo vuelve al proposer");
}
{
  let proposeCount = 0;
  const outcome = await runBoundedRetry<number>({
    maxRetries: 0,
    propose: async () => {
      proposeCount += 1;
      return { text: "x", tokensIn: 1, tokensOut: 1 };
    },
    gate: async () => ({ ok: false, rejection: { kind: "audit", reason: "x" } }),
  });
  assert(!outcome.ok && proposeCount === 1, "cota audit: maxRetries 0 no crea bucle nuevo");
  assert(!outcome.ok && outcome.lastRejection.kind === "audit", "cota audit: expone el ultimo rechazo");
}

// --- telemetria de la sub-fase audit ---
{
  assert(createPhaseTimings().auditMs.length === 0, "telemetry: auditMs arranca vacio");
  const timings = createPhaseTimings();
  timings.proposalMs.push(1000);
  timings.gateMs.push(2000);
  timings.tscMs.push(1500);
  timings.auditMs.push(500);
  const lines = timingLines(timings, 5000);
  const attempt = lines.find((line) => line.startsWith("Intento 1"));
  assert(attempt?.includes("tsc 1.5s") === true, "telemetry: muestra el tiempo de tsc");
  assert(attempt?.includes("audit 0.5s") === true, "telemetry: muestra el tiempo de auditoria");
}

console.log("");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
