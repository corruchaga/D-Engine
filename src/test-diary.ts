import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import {
  ABSOLUTE_MAX_DIARY_COMMITS,
  DEFAULT_DIARY_COMMITS,
  DIARY_MAX_CHARS,
  DIARY_STAT_FILES_MAX,
  buildDiary,
  buildDiarySection,
  formatDiaryCommit,
  parseDiaryLog,
  resolveDiaryCommits,
  type DiaryCommit,
} from "./diary.js";
import { diaryTokenLine } from "./telemetry.js";

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

async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

function writeRel(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

const gitEnv = {
  GIT_AUTHOR_NAME: "D-Engine Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "D-Engine Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

async function initRepo(dir: string): Promise<void> {
  await execa("git", ["init", "-q"], { cwd: dir });
}

async function commitAll(dir: string, message: string, date: string): Promise<void> {
  await execa("git", ["add", "-A"], { cwd: dir });
  await execa("git", ["-c", "commit.gpgsign=false", "commit", "-q", "-m", message], {
    cwd: dir,
    env: { ...process.env, ...gitEnv, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

// --- resolveDiaryCommits (config) ---
assert(resolveDiaryCommits(undefined) === DEFAULT_DIARY_COMMITS, "config: default sin variable");
assert(resolveDiaryCommits("") === DEFAULT_DIARY_COMMITS, "config: cadena vacia usa default");
assert(resolveDiaryCommits("3") === 3, "config: parsea entero");
assert(resolveDiaryCommits("50") === ABSOLUTE_MAX_DIARY_COMMITS, "config: aplica tope absoluto 20");
assert(resolveDiaryCommits("-1") === 0, "config: no admite negativos");
assert(resolveDiaryCommits("abc") === DEFAULT_DIARY_COMMITS, "config: no numerico usa default");
assert(resolveDiaryCommits("2.9") === 2, "config: trunca decimales");
assert(resolveDiaryCommits(4) === 4, "config: acepta numero directo");
assert(resolveDiaryCommits("0") === 0, "config: 0 es OFF");
assert(resolveDiaryCommits("false") === 0, "config: false es OFF");
assert(resolveDiaryCommits("OFF") === 0, "config: OFF (case-insensitive) es OFF");
assert(resolveDiaryCommits("no") === 0, "config: no es OFF");

// --- parseDiaryLog (canned) ---
const canned = [
  "\x1eabc1234\x1f2026-09-30\x1ffeat: guarda de stock",
  "3\t1\tsrc/calc.ts",
  "1\t0\tsrc/util.ts",
  "\x1edef5678\x1f2026-09-29\x1ffix: otra cosa",
  "5\t2\tsrc/calc.ts",
  "-\t-\tassets/logo.png",
  "",
].join("\n");
const parsed = parseDiaryLog(canned);
assert(parsed.length === 2, "parse: dos commits");
assert(
  parsed[0]?.hash === "abc1234" && parsed[0]?.date === "2026-09-30" && parsed[0]?.message === "feat: guarda de stock",
  "parse: hash, fecha y mensaje del primero"
);
assert(parsed[0]?.stat[0] === "src/calc.ts +3 -1", "parse: stat con +lineas -lineas");
assert(parsed[0]?.stat[1] === "src/util.ts +1 -0", "parse: stat segunda ruta");
assert(parsed[1]?.stat[1] === "assets/logo.png (bin)", "parse: binario marcado (bin)");
assert(parseDiaryLog("").length === 0, "parse: salida vacia");
assert(parseDiaryLog("\x1e\x1f\x1f\n").length === 0, "parse: registro sin hash ignorado");

// --- formatDiaryCommit (caps por commit) ---
const bigCommit: DiaryCommit = {
  hash: "aaaaaaa",
  date: "2026-01-01",
  message: "m".repeat(200),
  stat: Array.from({ length: 10 }, (_, i) => `src/f${i}.ts +1 -0`),
};
const formatted = formatDiaryCommit(bigCommit);
assert(formatted.includes("..."), "formato: mensaje largo recortado");
assert(
  formatted.split("\n").filter((line) => line.startsWith("  src/")).length === DIARY_STAT_FILES_MAX,
  "formato: maximo de archivos por commit"
);
assert(formatted.includes(`(+${10 - DIARY_STAT_FILES_MAX} archivos mas)`), "formato: resume archivos sobrantes");

// --- buildDiarySection (truncado) ---
const many: DiaryCommit[] = Array.from({ length: 20 }, (_, i) => ({
  hash: `h${String(i).padStart(6, "0")}`,
  date: "2026-01-01",
  message: `commit numero ${i} ${"y".repeat(80)}`,
  stat: Array.from({ length: 6 }, (_, j) => `src/archivo_${i}_${j}.ts +12 -3`),
}));
const trunc = buildDiarySection(many, 20);
assert(trunc.truncated === true, "truncado: se activa al superar el tope");
assert(trunc.section.length <= DIARY_MAX_CHARS, "truncado: respeta DIARY_MAX_CHARS");
assert(trunc.section.includes("(diario truncado: se muestran "), "truncado: anota cuantos se muestran");
assert(trunc.commits < trunc.totalCommits && trunc.totalCommits === 20, "truncado: recorta los mas antiguos");
assert(
  trunc.section.startsWith("--- DIARIO (ultimos 20 commits de estos archivos) ---"),
  "truncado: cabecera ASCII correcta"
);
assert(trunc.section.trimEnd().endsWith("--- FIN DIARIO ---"), "truncado: cierre correcto");
const single = buildDiarySection([many[0]!], 5);
assert(
  !single.truncated && single.commits === 1 && single.totalCommits === 1,
  "seccion: un solo commit sin truncar"
);
assert(buildDiarySection([], 5).section === "", "seccion: sin commits devuelve vacio");

// --- buildDiary con runner inyectado (tokens y args) ---
const cannedOut = "\x1eabc1234\x1f2026-09-30\x1fhola\n2\t1\tsrc/a.ts\n";
const injected = await buildDiary("C:/fake", ["src/a.ts"], {
  maxCommits: 5,
  runner: async () => cannedOut,
});
assert(injected.section.length > 0, "runner: produce seccion");
assert(
  injected.tokensEstimate === Math.ceil(injected.section.length / 4),
  "runner: tokens = ceil(chars/4)"
);
assert(injected.chars === injected.section.length, "runner: chars coincide con la seccion");

let captured: string[] = [];
await buildDiary("C:/fake", ["src/con espacio.ts"], {
  maxCommits: 5,
  runner: async (args) => {
    captured = args;
    return "";
  },
});
assert(captured.includes("--literal-pathspecs"), "args: usa --literal-pathspecs");
assert(captured.includes("--no-merges"), "args: usa --no-merges");
assert(captured.includes("-c") && captured.includes("core.quotepath=false"), "args: fuerza core.quotepath=false");
assert(captured.includes("src/con espacio.ts"), "args: ruta con espacios como argumento unico");
const dashIndex = captured.indexOf("--");
assert(
  dashIndex !== -1 && captured.slice(dashIndex + 1).join(",") === "src/con espacio.ts",
  "args: rutas despues de -- sin partir"
);

// --- OFF: no se ejecuta git ---
let offCalls = 0;
const off = await buildDiary("C:/fake", ["src/a.ts"], {
  maxCommits: 0,
  runner: async () => {
    offCalls += 1;
    return cannedOut;
  },
});
assert(off.section === "" && off.commits === 0 && off.tokensEstimate === 0, "OFF: diario vacio");
assert(offCalls === 0, "OFF: no invoca git (cero coste)");

// --- fail-open con runner que falla ---
assert(
  await rejects(() =>
    buildDiary("C:/fake", ["src/a.ts"], {
      maxCommits: 5,
      runner: async () => {
        throw new Error("boom");
      },
    })
  ),
  "fail-open: runner que falla propaga error (index lo captura)"
);

// --- repo git temporal: filtrado por ruta, archivo nuevo, sin historial ---
const repo = mkdtempSync(path.join(os.tmpdir(), "d-engine-diary-"));
await initRepo(repo);
writeRel(repo, "src/a.ts", "export const a = 1;\n");
await commitAll(repo, "feat: add alpha", "2026-01-01T10:00:00Z");
writeRel(repo, "src/b.ts", "export const b = 1;\n");
await commitAll(repo, "feat: add beta", "2026-01-02T10:00:00Z");

const aDiary = await buildDiary(repo, ["src/a.ts"], { maxCommits: 5 });
assert(aDiary.section.includes("add alpha"), "repo: incluye el commit que toco el archivo");
assert(!aDiary.section.includes("add beta"), "repo: excluye commits de otras rutas");
assert(aDiary.section.includes("src/a.ts +1 -0"), "repo: stat del archivo objetivo");
assert(aDiary.section.includes("--- DIARIO (ultimos 5 commits"), "repo: cabecera con N efectivo");

writeRel(repo, "src/new.ts", "export const n = 1;\n");
const mixedDiary = await buildDiary(repo, ["src/a.ts", "src/new.ts"], { maxCommits: 5 });
assert(mixedDiary.section.includes("add alpha"), "archivo nuevo: no rompe el diario de los demas");
const newOnly = await buildDiary(repo, ["src/new.ts"], { maxCommits: 5 });
assert(newOnly.section === "" && newOnly.commits === 0, "archivo nuevo: sin diario propio");

const none = await buildDiary(repo, ["src/nonexistent.ts"], { maxCommits: 5 });
assert(none.section === "" && none.commits === 0, "sin historial relevante: seccion omitida");

writeRel(repo, "src/weird name.ts", "export const w = 1;\n");
await commitAll(repo, "feat: add weird", "2026-01-03T10:00:00Z");
const weird = await buildDiary(repo, ["src/weird name.ts"], { maxCommits: 5 });
assert(weird.section.includes("add weird"), "ruta con espacios: git la resuelve");
assert(weird.section.includes("src/weird name.ts"), "ruta con espacios: aparece en el stat");

// --- repo no-git: fail-open ruidoso ---
const plain = mkdtempSync(path.join(os.tmpdir(), "d-engine-diary-plain-"));
assert(
  await rejects(() => buildDiary(plain, ["src/a.ts"], { maxCommits: 5 })),
  "no-git: buildDiary lanza (index avisa y continua)"
);

// --- telemetria del diario ---
assert(diaryTokenLine(380, 5, 5) === "Diario: ~380 tokens (5 commits)", "telemetria: plural");
assert(diaryTokenLine(380, 1, 1) === "Diario: ~380 tokens (1 commit)", "telemetria: singular");
assert(diaryTokenLine(380, 5, 12) === "Diario: ~380 tokens (5 de 12 commits)", "telemetria: truncado");

console.log("");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
