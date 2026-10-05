import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LLMParser, LocalEditor, type NewFileBlock } from "./engine.js";
import { isSafeNewPath, resolveSelectorPaths } from "./selector.js";

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

function writeRel(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

function readRel(root: string, rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function threw(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "d-engine-newfile-"));

const basic = ["NEW FILE: src/coupons.ts", "<<<EOF", "export interface Coupon {", "  code: string;", "}", "EOF", ""].join(
  "\n"
);
const basicBlocks = LLMParser.parse(basic);
assert(basicBlocks.length === 1, "NEW FILE: parser extrae 1 bloque");
const basicBlock = basicBlocks[0];
assert(basicBlock?.kind === "new", "NEW FILE: tipo new");
assert(basicBlock?.filePath === "src/coupons.ts", "NEW FILE: ruta inline");
assert(
  basicBlock?.kind === "new" && basicBlock.content.includes("export interface Coupon"),
  "NEW FILE: contenido capturado"
);

const tricky = [
  "NEW FILE: src/tricky.ts",
  "<<<EOF",
  "const s = `code fence ``` inside`;",
  "const q = \"double 'single' quotes\";",
  "EOF",
  "",
].join("\n");
const trickyBlocks = LLMParser.parse(tricky);
assert(trickyBlocks.length === 1 && trickyBlocks[0]?.kind === "new", "NEW FILE: contenido con comillas y fences");
assert(
  trickyBlocks[0]?.kind === "new" && trickyBlocks[0].content.includes("``` inside") && trickyBlocks[0].content.includes("'single'"),
  "NEW FILE: comillas/fences preservados"
);

assert(
  threw(() => LLMParser.parse("NEW FILE: /etc/evil.ts\n<<<EOF\nx\nEOF\n")),
  "NEW FILE: ruta absoluta rechazada"
);
assert(
  threw(() => LLMParser.parse("NEW FILE: ../evil.ts\n<<<EOF\nx\nEOF\n")),
  "NEW FILE: ruta con .. rechazada"
);
assert(
  threw(() => LLMParser.parse("NEW FILE: src/empty.ts\n<<<EOF\nEOF\n")),
  "NEW FILE: contenido vacio rechazado"
);
assert(
  threw(() => LLMParser.parse("NEW FILE: src/blank.ts\n<<<EOF\n   \nEOF\n")),
  "NEW FILE: contenido solo espacios rechazado"
);

const sneaky = [
  "NEW FILE: src/sneaky.ts",
  "<<<EOF",
  "// <<<<<<< SEARCH",
  "// =======",
  "// >>>>>>> REPLACE",
  "export const sneaky = 1;",
  "EOF",
  "",
].join("\n");
const sneakyBlocks = LLMParser.parse(sneaky);
assert(
  sneakyBlocks.length === 1 && sneakyBlocks[0]?.kind === "new",
  "NEW FILE: marcadores internos no generan un segundo bloque"
);

const created = LLMParser.parse("NEW FILE: src/deep/nested/coupons.ts\n<<<EOF\nexport const x = 1;\nEOF\n")[0];
assert(created?.kind === "new", "creacion: bloque parseado");
const createdResult = LocalEditor.apply(tmp, created!);
assert(createdResult.strategy === "new-file", "creacion: estrategia new-file");
assert(
  readRel(tmp, "src/deep/nested/coupons.ts") === "export const x = 1;\n",
  "creacion: archivo y directorios intermedios materializados"
);

writeRel(tmp, "src/existing.ts", "export const old = 1;\n");
const overExisting: NewFileBlock = {
  kind: "new",
  filePath: "src/existing.ts",
  content: "export const nope = 2;\n",
};
assert(threw(() => LocalEditor.apply(tmp, overExisting)), "NEW FILE sobre existente rechazado en apply");
assert(readRel(tmp, "src/existing.ts") === "export const old = 1;\n", "NEW FILE sobre existente: contenido intacto");
assert(
  threw(() => LocalEditor.preflight(tmp, [overExisting])),
  "NEW FILE sobre existente rechazado en preflight"
);

assert(
  threw(() =>
    LocalEditor.preflight(tmp, [{ kind: "edit", filePath: "src/missing.ts", search: "a", replace: "b" }])
  ),
  "SEARCH/REPLACE sobre inexistente rechazado en preflight"
);

assert(
  threw(() =>
    LocalEditor.preflight(tmp, [
      { kind: "new", filePath: "src/dup.ts", content: "a\n" },
      { kind: "new", filePath: "src/dup.ts", content: "b\n" },
    ])
  ),
  "NEW FILE duplicado en el mismo parche rechazado"
);

const mixed = [
  "NEW FILE: src/a.ts",
  "<<<EOF",
  "export const a = 1;",
  "EOF",
  "",
  "src/b.ts",
  "<<<<<<< SEARCH",
  "export const b = 1;",
  "=======",
  "export const b = 2;",
  ">>>>>>> REPLACE",
  "",
].join("\n");
writeRel(tmp, "src/b.ts", "export const b = 1;\n");
const mixedBlocks = LLMParser.parse(mixed);
assert(
  mixedBlocks.length === 2 && mixedBlocks[0]?.kind === "new" && mixedBlocks[1]?.kind === "edit",
  "mixto: parser extrae NEW FILE y SEARCH/REPLACE en orden"
);
LocalEditor.preflight(tmp, mixedBlocks);
const mixedResults = mixedBlocks.map((block) => LocalEditor.apply(tmp, block));
assert(mixedResults[0]?.strategy === "new-file", "mixto: crea el nuevo");
assert(mixedResults[1]?.strategy === "exact", "mixto: edita el existente");
assert(readRel(tmp, "src/a.ts") === "export const a = 1;\n", "mixto: contenido del nuevo");
assert(readRel(tmp, "src/b.ts") === "export const b = 2;\n", "mixto: contenido editado");

assert(isSafeNewPath("src/x.ts"), "isSafeNewPath: ruta valida");
assert(!isSafeNewPath("/abs/x.ts"), "isSafeNewPath: absoluta rechazada");
assert(!isSafeNewPath("../x.ts"), "isSafeNewPath: .. rechazada");
assert(!isSafeNewPath("C:/x.ts"), "isSafeNewPath: unidad rechazada");
assert(!isSafeNewPath("src/x y.ts"), "isSafeNewPath: espacios rechazados");

const candidates = ["src/engine.ts"];
const allowNew = resolveSelectorPaths('["src/engine.ts","src/coupons.ts"]', candidates, { allowNew: true });
assert(
  allowNew.ok && allowNew.newPaths.length === 1 && allowNew.newPaths[0] === "src/coupons.ts",
  "selector allowNew: acepta ruta nueva bajo src/"
);
const outside = resolveSelectorPaths('["src/engine.ts","lib/coupons.ts"]', candidates, { allowNew: true });
assert(!outside.ok, "selector allowNew: rechaza ruta nueva fuera de src/");
const noNew = resolveSelectorPaths('["src/engine.ts","src/missing.ts"]', candidates);
assert(!noNew.ok, "selector estricto: sigue rechazando ruta inexistente");
const onlyKnown = resolveSelectorPaths('["src/engine.ts"]', candidates, { allowNew: true });
assert(onlyKnown.ok && onlyKnown.newPaths.length === 0, "selector allowNew: sin nuevas cuando no hacen falta");

console.log("");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
