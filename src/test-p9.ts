import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listSourceFiles,
  packSelectorCatalog,
  type SelectorCatalogFile,
} from "./context.js";
import { SELECTOR_SYSTEM } from "./llm.js";
import { parseSelectorResponse, validateSelectorPaths } from "./selector.js";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${msg}`);
    return;
  }
  failed += 1;
  console.error(`FAIL  ${msg}`);
}

function entry(rel: string, extra?: Partial<SelectorCatalogFile>): SelectorCatalogFile {
  return {
    rel,
    snippet: `export function ${rel.replace(/[^\w]/g, "_")}() {}`,
    ts: 1,
    isTest: false,
    score: 0,
    ...extra,
  };
}

assert(
  SELECTOR_SYSTEM.includes("MINIMO conjunto") &&
    SELECTOR_SYSTEM.includes("por si acaso") &&
    /importen o usen/i.test(SELECTOR_SYSTEM),
  "prompt del selector pide minimo conjunto"
);

const candidates = ["src/engine.ts", "src/index.ts", "src/llm.ts"];

assert(
  JSON.stringify(parseSelectorResponse(`["src/engine.ts","src/index.ts"]`)) ===
    JSON.stringify(["src/engine.ts", "src/index.ts"]),
  "JSON limpio"
);

assert(
  JSON.stringify(
    parseSelectorResponse("```json\n[\"src/engine.ts\"]\n```")
  ) === JSON.stringify(["src/engine.ts"]),
  "JSON con fences"
);

assert(
  JSON.stringify(
    parseSelectorResponse('Aqui va:\n["src/llm.ts"]\nlisto')
  ) === JSON.stringify(["src/llm.ts"]),
  "JSON con basura alrededor"
);

assert(
  JSON.stringify(parseSelectorResponse("src/engine.ts\nsrc/index.ts")) ===
    JSON.stringify(["src/engine.ts", "src/index.ts"]),
  "fallback por lineas"
);

assert(
  JSON.stringify(parseSelectorResponse("- `src/engine.ts`\n1. src/index.ts")) ===
    JSON.stringify(["src/engine.ts", "src/index.ts"]),
  "lineas con vinietas y backticks"
);

assert(parseSelectorResponse("") === null, "vacio es invalido");
assert(parseSelectorResponse('{"file":"src/engine.ts"}') === null, "objeto JSON es invalido");
assert(parseSelectorResponse("ningun archivo, solo texto") === null, "texto libre es invalido");

const missing = validateSelectorPaths(["src/missing.ts"], candidates);
assert(!missing.ok && missing.invalid.includes("src/missing.ts"), "ruta inexistente se rechaza");

const mixed = validateSelectorPaths(["src/engine.ts", "DECISIONS.md"], candidates);
assert(!mixed.ok, "fuera de catalogo no se silencia aunque haya rutas buenas");
assert(mixed.ok === false && mixed.invalid.includes("DECISIONS.md"), "reporta la ruta fuera de catalogo");

const ok = validateSelectorPaths(["src/engine.ts", "src/engine.ts"], candidates);
assert(ok.ok && ok.paths.length === 1 && ok.paths[0] === "src/engine.ts", "dedup de rutas validas");

const packed = packSelectorCatalog(
  [
    entry("src/a.ts", { snippet: "A".repeat(20), score: 5 }),
    entry("src/b.ts", { snippet: "B".repeat(20), score: 1 }),
    entry("src/c.ts", { snippet: "C".repeat(20), score: 0 }),
  ],
  50
);
assert(packed.candidates.length === 3, "candidates conserva todos los archivos");
assert(packed.text.length <= 50, "catalogo respeta tope de chars");
assert(packed.text.includes("OTROS:"), "recorte emite OTROS");
assert(!packed.text.includes("node_modules") && !packed.text.includes("/dist/"), "catalogo sin node_modules/dist");

const testsLast = packSelectorCatalog(
  [
    entry("src/test-p9.ts", { isTest: true, score: 9, snippet: "TEST" }),
    entry("src/engine.ts", { isTest: false, score: 9, snippet: "ENG" }),
  ],
  80
);
const engineAt = testsLast.text.indexOf("src/engine.ts");
const testAt = testsLast.text.indexOf("src/test-p9.ts");
assert(engineAt !== -1 && (testAt === -1 || engineAt < testAt), "tests se recortan despues que no-test");

const tmp = mkdtempSync(path.join(os.tmpdir(), "d-engine-p9-"));
mkdirSync(path.join(tmp, "src", "node_modules"), { recursive: true });
mkdirSync(path.join(tmp, "src", "dist"), { recursive: true });
mkdirSync(path.join(tmp, "node_modules"), { recursive: true });
writeFileSync(path.join(tmp, "src", "keep.ts"), "export const keep = 1;\n");
writeFileSync(path.join(tmp, "src", "node_modules", "skip.ts"), "export const skip = 1;\n");
writeFileSync(path.join(tmp, "src", "dist", "skip.ts"), "export const skip = 1;\n");
writeFileSync(path.join(tmp, "node_modules", "skip.ts"), "export const skip = 1;\n");
const listed = listSourceFiles(tmp);
assert(listed.includes("src/keep.ts"), "lista src/keep.ts");
assert(
  listed.every((rel) => !rel.includes("node_modules") && !rel.includes("dist")),
  "listSourceFiles excluye node_modules y dist"
);

console.log("");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
