import { execa } from "execa";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface GitOptions {
  cwd?: string;
  allowFail?: boolean;
}

function gitLog(message: string): void {
  console.log(`[d-engine:git] ${message}`);
}

async function runGit(args: string[], action: string, options: GitOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  gitLog(`${action}`);
  gitLog(`  cwd: ${cwd}`);
  gitLog(`  $ git ${args.join(" ")}`);
  try {
    const result = await execa("git", args, { cwd });
    const stdout = result.stdout.trim();
    const stderr = result.stderr.trim();
    gitLog(stdout.length > 0 ? `  ok stdout:\n${stdout}` : "  ok (sin stdout)");
    if (stderr.length > 0) gitLog(`  stderr:\n${stderr}`);
    return result.stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    const stdout = (error as { stdout?: string }).stdout?.trim();
    const detail = error instanceof Error ? error.message : String(error);
    const info = stderr || stdout || detail;
    gitLog(`  FAIL: ${info}`);
    if (options.allowFail) {
      gitLog("  (ignorado: destroy/guard idempotente)");
      return "";
    }
    throw new Error(`git no pudo ${action}: ${info}`);
  }
}

export class ShadowWorkspace {
  private branch = "";
  private worktreePath = "";
  private originalBranch = "";
  private repoRoot = "";

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
    this.repoRoot = process.cwd();

    const current = await runGit(["branch", "--show-current"], "detectar la rama actual", {
      cwd: this.repoRoot,
    });
    this.originalBranch = current.trim();

    await runGit(
      ["worktree", "add", "-b", this.branch, this.worktreePath],
      "crear la fotocopia",
      { cwd: this.repoRoot }
    );

    return this.worktreePath;
  }

  async destroy(): Promise<void> {
    const root = this.repoRoot || process.cwd();

    if (this.worktreePath) {
      await runGit(
        ["worktree", "remove", "--force", this.worktreePath],
        "borrar worktree (primero)",
        { cwd: root, allowFail: true }
      );
    }

    await runGit(["worktree", "prune"], "purgar worktrees huerfanos", {
      cwd: root,
      allowFail: true,
    });

    if (this.worktreePath && existsSync(this.worktreePath)) {
      try {
        await rm(this.worktreePath, { recursive: true, force: true });
        gitLog("carpeta residual eliminada");
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        gitLog(`no se pudo eliminar la carpeta física: ${reason}`);
      }
    }

    if (this.branch) {
      await runGit(["branch", "-D", this.branch], "borrar rama temporal (despues)", {
        cwd: root,
        allowFail: true,
      });
    }
  }

  async commitAndMerge(message: string): Promise<boolean> {
    const photocopy = this.worktreePath;
    const root = this.repoRoot || process.cwd();

    gitLog(`commitAndMerge: fotocopia=${photocopy}`);
    gitLog(`commitAndMerge: repo principal=${root} rama=${this.originalBranch || "(desconocida)"}`);

    const porcelain = await runGit(["status", "--porcelain", "-uall"], "status en la FOTOCOPIA (no en master)", {
      cwd: photocopy,
    });
    gitLog(`guard porcelain (fotocopia):\n${porcelain.trim() || "(vacio)"}`);

    await runGit(["add", "-A"], "git add -A en la FOTOCOPIA", { cwd: photocopy });

    const staged = await runGit(["diff", "--cached", "--name-only"], "archivos staged en la FOTOCOPIA", {
      cwd: photocopy,
    });
    gitLog(`guard staged (fotocopia):\n${staged.trim() || "(vacio)"}`);

    if (staged.trim().length === 0) {
      gitLog("sin cambios que consolidar: la fotocopia no tiene diff staged");
      return false;
    }

    await runGit(["commit", "-m", message], "commit en la FOTOCOPIA (rama shadow)", {
      cwd: photocopy,
    });

    const incoming = await runGit(
      ["diff", "--name-only", "HEAD", this.branch],
      "archivos que la fotocopia trae a master",
      { cwd: root }
    );

    for (const rel of incoming.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
      const track = await runGit(["status", "--porcelain", "--", rel], `estado de ${rel} en el repo principal`, {
        cwd: root,
        allowFail: true,
      });
      if (track.trim().startsWith("??")) {
        const abs = path.join(root, rel);
        if (existsSync(abs)) {
          unlinkSync(abs);
          gitLog(`quitado untracked que bloqueaba el merge: ${rel}`);
        }
      }
    }

    await runGit(
      ["merge", "--no-edit", this.branch],
      `merge ${this.branch} -> ${this.originalBranch || "rama actual"} (repo principal)`,
      { cwd: root }
    );

    return true;
  }

  async headLog(): Promise<string> {
    const root = this.repoRoot || process.cwd();
    return (await runGit(["log", "-1", "--oneline"], "git log -1 (master/HEAD)", { cwd: root })).trim();
  }

  async diffHead(): Promise<string> {
    const photocopy = this.worktreePath;
    gitLog("diff HEAD en la FOTOCOPIA");
    gitLog(`  cwd: ${photocopy}`);
    gitLog("  $ git diff HEAD");
    const result = await execa("git", ["diff", "HEAD"], { cwd: photocopy, reject: false });
    const stdout = result.stdout.trim();
    gitLog(stdout.length > 0 ? `  ok stdout:\n${stdout}` : "  ok (sin stdout)");
    return result.stdout;
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

export interface ValidatorOptions {
  command?: string;
}

export interface ValidatorResult {
  ok: boolean;
  output: string;
}

export class Validator {
  static async run(cwd: string, options: ValidatorOptions = {}): Promise<ValidatorResult> {
    const command = options.command ?? "tsc --noEmit";
    const tokens = command.trim().split(/\s+/).filter((part) => part.length > 0);
    const bin = tokens[0];
    if (!bin) {
      return { ok: false, output: "No se indico ningun comando de verificacion." };
    }
    const args = tokens.slice(1);

    try {
      const result = await execa(bin, args, {
        cwd,
        reject: false,
        all: true,
        preferLocal: true,
        localDir: process.cwd(),
      });
      const output = (result.all ?? `${result.stdout}\n${result.stderr}`).trim();
      if (result.exitCode === 0) {
        return { ok: true, output };
      }
      return { ok: false, output };
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr?.trim();
      const stdout = (error as { stdout?: string }).stdout?.trim();
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, output: stderr || stdout || detail };
    }
  }
}
