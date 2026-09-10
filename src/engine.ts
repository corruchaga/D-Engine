import { execa } from "execa";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

interface GitOptions {
  cwd?: string;
}

async function runGit(args: string[], action: string, options: GitOptions = {}): Promise<string> {
  try {
    const { stdout } = await execa("git", args, options);
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`git no pudo ${action}: ${stderr || detail}`);
  }
}

export class ShadowWorkspace {
  private branch = "";
  private worktreePath = "";
  private originalBranch = "";

  get path(): string {
    return this.worktreePath;
  }

  get branchName(): string {
    return this.branch;
  }

  get baseBranch(): string {
    return this.originalBranch;
  }

  async create(): Promise<string> {
    const stamp = Date.now();
    this.branch = `shadow-${stamp}`;
    this.worktreePath = path.join(os.tmpdir(), `d-engine-${stamp}`);

    const current = await runGit(["branch", "--show-current"], "detectar la rama actual");
    this.originalBranch = current.trim();

    await runGit(
      ["worktree", "add", "-b", this.branch, this.worktreePath],
      "crear la fotocopia"
    );

    return this.worktreePath;
  }

  async destroy(): Promise<void> {
    await runGit(
      ["worktree", "remove", "--force", this.worktreePath],
      "borrar la fotocopia"
    );
    await runGit(["branch", "-D", this.branch], "borrar la rama temporal");
  }

  async commitAndMerge(message: string): Promise<boolean> {
    const status = await runGit(["status", "--porcelain"], "comprobar cambios pendientes", {
      cwd: this.worktreePath,
    });

    if (status.trim().length === 0) {
      return false;
    }

    await runGit(["add", "-A"], "preparar los cambios", { cwd: this.worktreePath });
    await runGit(["commit", "-m", message], "hacer commit en la fotocopia", {
      cwd: this.worktreePath,
    });
    await runGit(["merge", this.branch], "fusionar en la rama original");
    return true;
  }
}

export interface EditBlock {
  filePath: string;
  search: string;
  replace: string;
}

export type ApplyStrategy =
  | "exact"
  | "normalize-newlines"
  | "ignore-trailing-whitespace"
  | "fuzzy"
  | "rewrite";

export interface ApplyResult {
  filePath: string;
  strategy: ApplyStrategy;
}

const FUZZY_THRESHOLD = 0.85;
const SMALL_FILE_CHARS = 1200;

const BLOCK_RE =
  /<<<<<<< SEARCH[^\n]*\r?\n([\s\S]*?)\r?\n=======[^\n]*\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;

function stripDecor(value: string): string {
  return value.replace(/^[`"'*]+|[`"'*]+$/g, "").trim();
}

function looksLikePath(value: string): boolean {
  const t = stripDecor(value);
  return /[\\/]/.test(t) || /\.\w{1,8}$/.test(t);
}

function extractPathBefore(before: string): string {
  const lines = before.replace(/[ \t]+$/g, "").split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const line = raw.trim();
    if (line.length === 0 || line === "```") continue;
    if (line.startsWith("```")) {
      const rest = line.slice(3).trim();
      if (!rest) continue;
      const tokens = rest.split(/\s+/);
      const last = tokens[tokens.length - 1];
      if (last && looksLikePath(last)) return stripDecor(last);
      const first = tokens[0];
      if (first && looksLikePath(first)) return stripDecor(first);
      continue;
    }
    if (looksLikePath(line)) return stripDecor(line);
  }
  throw new Error("Bloque SEARCH/REPLACE sin ruta de archivo.");
}

export class LLMParser {
  static parse(markdown: string): EditBlock[] {
    const blocks: EditBlock[] = [];
    const re = new RegExp(BLOCK_RE.source, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(markdown)) !== null) {
      const search = match[1];
      const replace = match[2];
      if (search === undefined || replace === undefined) continue;
      const filePath = extractPathBefore(markdown.slice(0, match.index));
      blocks.push({ filePath, search, replace });
    }
    if (blocks.length === 0) {
      throw new Error("No se encontro ningun bloque SEARCH/REPLACE valido en la respuesta del modelo.");
    }
    return blocks;
  }
}

function uniqueIndex(haystack: string, needle: string): number | null {
  if (needle.length === 0) return null;
  const first = haystack.indexOf(needle);
  if (first === -1) return null;
  const second = haystack.indexOf(needle, first + needle.length);
  if (second !== -1) return null;
  return first;
}

function replaceAt(haystack: string, index: number, length: number, replacement: string): string {
  return haystack.slice(0, index) + replacement + haystack.slice(index + length);
}

function fileNewline(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function toLf(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function stripTrail(line: string): string {
  return line.replace(/[ \t]+$/g, "");
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = new Array<number>(rows * cols);
  const at = (i: number, j: number): number => i * cols + j;
  for (let i = 0; i < rows; i++) dp[at(i, 0)] = i;
  for (let j = 0; j < cols; j++) dp[at(0, j)] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const del = (dp[at(i - 1, j)] ?? 0) + 1;
      const ins = (dp[at(i, j - 1)] ?? 0) + 1;
      const sub = (dp[at(i - 1, j - 1)] ?? 0) + cost;
      dp[at(i, j)] = Math.min(del, ins, sub);
    }
  }
  return dp[at(rows - 1, cols - 1)] ?? 0;
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function applyIgnoreTrailing(content: string, search: string, replace: string): string | null {
  const nl = fileNewline(content);
  const contentLines = toLf(content).split("\n");
  const searchLines = toLf(search).split("\n");
  const searchStripped = searchLines.map(stripTrail);
  if (searchLines.length === 0) return null;

  let found = -1;
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let ok = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (stripTrail(contentLines[i + j] ?? "") !== (searchStripped[j] ?? "")) {
        ok = false;
        break;
      }
    }
    if (ok) {
      if (found !== -1) return null;
      found = i;
    }
  }
  if (found === -1) return null;

  const replaceLines = toLf(replace).split("\n");
  const next = [
    ...contentLines.slice(0, found),
    ...replaceLines,
    ...contentLines.slice(found + searchLines.length),
  ];
  return next.join(nl);
}

function applyFuzzy(content: string, search: string, replace: string): string | null {
  const nl = fileNewline(content);
  const contentLines = toLf(content).split("\n");
  const searchLines = toLf(search).split("\n");
  const n = searchLines.length;
  if (n === 0) return null;

  let bestIdx = -1;
  let bestScore = -1;
  for (let i = 0; i <= contentLines.length - n; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      sum += similarity(contentLines[i + j] ?? "", searchLines[j] ?? "");
    }
    const avg = sum / n;
    if (avg >= FUZZY_THRESHOLD && avg > bestScore) {
      bestScore = avg;
      bestIdx = i;
    }
  }
  if (bestIdx === -1) return null;

  const replaceLines = toLf(replace).split("\n");
  const next = [
    ...contentLines.slice(0, bestIdx),
    ...replaceLines,
    ...contentLines.slice(bestIdx + n),
  ];
  return next.join(nl);
}

function applyCascade(
  content: string,
  search: string,
  replace: string
): { content: string; strategy: ApplyStrategy } | null {
  const exactAt = uniqueIndex(content, search);
  if (exactAt !== null) {
    return { content: replaceAt(content, exactAt, search.length, replace), strategy: "exact" };
  }

  const normContent = toLf(content);
  const normSearch = toLf(search);
  const normReplace = toLf(replace);
  const normAt = uniqueIndex(normContent, normSearch);
  if (normAt !== null) {
    let out = replaceAt(normContent, normAt, normSearch.length, normReplace);
    if (content.includes("\r\n")) out = out.replace(/\n/g, "\r\n");
    return { content: out, strategy: "normalize-newlines" };
  }

  const trailed = applyIgnoreTrailing(content, search, replace);
  if (trailed !== null) {
    return { content: trailed, strategy: "ignore-trailing-whitespace" };
  }

  const fuzzy = applyFuzzy(content, search, replace);
  if (fuzzy !== null) {
    return { content: fuzzy, strategy: "fuzzy" };
  }

  return null;
}

function previewSearch(search: string): string {
  return search
    .split(/\r?\n/)
    .slice(0, 4)
    .map((line) => `  ${line}`)
    .join("\n");
}

export class LocalEditor {
  static apply(rootDir: string, block: EditBlock): ApplyResult {
    const abs = path.join(rootDir, block.filePath);
    if (!existsSync(abs)) {
      throw new Error(`El archivo no existe en la fotocopia: ${block.filePath}`);
    }

    const original = readFileSync(abs, "utf8");

    if (original.length < SMALL_FILE_CHARS && block.search.trim().length === 0) {
      writeFileSync(abs, block.replace, "utf8");
      return { filePath: block.filePath, strategy: "rewrite" };
    }

    const applied = applyCascade(original, block.search, block.replace);
    if (!applied) {
      throw new Error(
        [
          "No se pudo aplicar el bloque SEARCH/REPLACE.",
          `Archivo: ${block.filePath}`,
          "Estrategias intentadas: 4 (exact, normalize-newlines, ignore-trailing-whitespace, fuzzy)",
          "SEARCH (primeras lineas):",
          previewSearch(block.search),
        ].join("\n")
      );
    }

    writeFileSync(abs, applied.content, "utf8");
    return { filePath: block.filePath, strategy: applied.strategy };
  }
}
