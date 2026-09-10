import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LLMParser, LocalEditor, type ApplyStrategy } from "./engine.js";

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

const tmp = mkdtempSync(path.join(os.tmpdir(), "d-engine-p3-"));

const mdPerfect = `perfect.ts
<<<<<<< SEARCH
const x = 1;
=======
const x = 42;
>>>>>>> REPLACE
`;

const mdTrail = `trail.ts
<<<<<<< SEARCH
hello world 
=======
hello universe
>>>>>>> REPLACE
`;

const mdIndent = `indent.ts
<<<<<<< SEARCH
    const result = computeTotal(a, b);
=======
    const result = computeTotal(a, b, c);
>>>>>>> REPLACE
`;

const mdCrlf = [
  "crlf.ts",
  "<<<<<<< SEARCH",
  "lineA",
  "lineB",
  "=======",
  "lineA",
  "lineB-mod",
  ">>>>>>> REPLACE",
].join("\r\n");

writeRel(tmp, "perfect.ts", "const x = 1;\nconst y = 2;\n");
writeRel(tmp, "trail.ts", "hello world\nfoo\n");
writeRel(tmp, "indent.ts", "function f() {\n  const result = computeTotal(a, b);\n  return result;\n}\n");
writeRel(tmp, "crlf.ts", "lineA\nlineB\nlineC\n");

function runCase(
  name: string,
  markdown: string,
  file: string,
  expectedStrategy: ApplyStrategy,
  expectedContent: string
): void {
  const blocks = LLMParser.parse(markdown);
  assert(blocks.length === 1, `${name}: parser extrae 1 bloque`);
  const block = blocks[0];
  if (!block) {
    failed += 1;
    console.error(`FAIL  ${name}: bloque indefinido`);
    return;
  }
  assert(block.filePath === file, `${name}: parser extrae ruta ${file} (obtuvo ${block.filePath})`);
  const result = LocalEditor.apply(tmp, block);
  assert(result.strategy === expectedStrategy, `${name}: estrategia ${expectedStrategy} (obtuvo ${result.strategy})`);
  const got = readRel(tmp, file);
  assert(got === expectedContent, `${name}: contenido aplicado correctamente`);
}

runCase(
  "1 bloque perfecto",
  mdPerfect,
  "perfect.ts",
  "exact",
  "const x = 42;\nconst y = 2;\n"
);

runCase(
  "2 espacio al final de linea",
  mdTrail,
  "trail.ts",
  "ignore-trailing-whitespace",
  "hello universe\nfoo\n"
);

runCase(
  "3 indentacion distinta",
  mdIndent,
  "indent.ts",
  "fuzzy",
  "function f() {\n    const result = computeTotal(a, b, c);\n  return result;\n}\n"
);

runCase(
  "4 saltos Windows CRLF",
  mdCrlf,
  "crlf.ts",
  "normalize-newlines",
  "lineA\nlineB-mod\nlineC\n"
);

const mdFenced = "```ts src/fenced.ts\n<<<<<<< SEARCH\nalpha\n=======\nbeta\n>>>>>>> REPLACE\n```\n";
writeRel(tmp, "src/fenced.ts", "alpha\n");
const fenced = LLMParser.parse(mdFenced);
assert(fenced.length === 1, "diff-fenced: parser extrae 1 bloque");
assert(fenced[0]?.filePath === "src/fenced.ts", `diff-fenced: ruta en cabecera (obtuvo ${fenced[0]?.filePath})`);
const fencedResult = LocalEditor.apply(tmp, fenced[0]!);
assert(fencedResult.strategy === "exact", "diff-fenced: aplica exact");
assert(readRel(tmp, "src/fenced.ts") === "beta\n", "diff-fenced: contenido aplicado");

const mdMulti = `a.ts
<<<<<<< SEARCH
one
=======
ONE
>>>>>>> REPLACE

b.ts
<<<<<<< SEARCH
two
=======
TWO
>>>>>>> REPLACE
`;
writeRel(tmp, "a.ts", "one\n");
writeRel(tmp, "b.ts", "two\n");
const multi = LLMParser.parse(mdMulti);
assert(multi.length === 2, "multi-bloque: parser extrae 2 bloques");
if (multi[0] && multi[1]) {
  LocalEditor.apply(tmp, multi[0]);
  LocalEditor.apply(tmp, multi[1]);
}
assert(readRel(tmp, "a.ts") === "ONE\n" && readRel(tmp, "b.ts") === "TWO\n", "multi-bloque: ambos aplicados");

let threw = false;
try {
  LLMParser.parse("hola sin bloques");
} catch {
  threw = true;
}
assert(threw, "parser lanza error si no hay bloques validos");

console.log("");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
