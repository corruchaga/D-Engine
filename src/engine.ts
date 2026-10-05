import { execa } from "execa";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface GitOptions {
  cwd?: string;
  allowFail?: boolean;
}

export class PorcelainGuardError extends Error {
  readonly files: string[];
  constructor(files: string[]) {
    super(`La fotocopia tiene cambios fuera de los archivos del parche: ${files.join(", ")}`);
    this.name = "PorcelainGuardError";
    this.files = files;
  }
}

function gitLog(message: string): void {
  console.log(`[d-engine:git] ${message}`);
}

function normalizeRepoPath(rel: string): string {
  return rel.replaceAll("\\", "/").replace(/^\.\//, "");
}

function unquoteGitPath(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  return value;
}

function parsePorcelainPaths(porcelain: string): string[] {
  const paths: string[] = [];
  for (const rawLine of porcelain.split(/\r?\n/)) {
    if (rawLine.length === 0) continue;
    const rest = rawLine.length >= 3 ? rawLine.slice(3) : rawLine.trim();
    const parts = rest.includes(" -> ") ? rest.split(" -> ") : [rest];
    for (const part of parts) {
      const cleaned = normalizeRepoPath(unquoteGitPath(part.trim()));
      if (cleaned) paths.push(cleaned);
    }
  }
  return paths;
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

async function logOffendingDiffs(cwd: string, files: string[]): Promise<void> {
  for (const rel of files) {
    await runGit(["diff", "HEAD", "--", rel], `diff HEAD -- ${rel} (ofensor)`, {
      cwd,
      allowFail: true,
    });
    await runGit(["diff", "--cached", "--", rel], `diff --cached -- ${rel} (ofensor)`, {
      cwd,
      allowFail: true,
    });
  }
}

function unlinkIfLink(target: string): void {
  try {
    if (!existsSync(target)) return;
    if (!lstatSync(target).isSymbolicLink()) return;
    rmSync(target, { recursive: false, force: true });
    gitLog(`enlace quitado antes del borrado: ${target}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    gitLog(`no se pudo quitar el enlace ${target}: ${reason}`);
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
      unlinkIfLink(path.join(this.worktreePath, "node_modules"));
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

  async restoreFiles(files: string[]): Promise<void> {
    const photocopy = this.worktreePath;
    const unique = [...new Set(files.map(normalizeRepoPath).filter(Boolean))];
    if (!photocopy || unique.length === 0) return;
    for (const rel of unique) {
      const tree = await runGit(["ls-tree", "HEAD", "--", rel], `ver si ${rel} existe en HEAD`, {
        cwd: photocopy,
        allowFail: true,
      });
      if (tree.trim().length > 0) {
        await runGit(["checkout", "HEAD", "--", rel], `restaurar ${rel} al HEAD de la fotocopia`, {
          cwd: photocopy,
          allowFail: true,
        });
        continue;
      }
      const abs = path.join(photocopy, rel);
      if (existsSync(abs)) {
        unlinkSync(abs);
        gitLog(`restaurar: borrado archivo nuevo ${rel}`);
      }
    }
  }

  async commitAndMerge(message: string, files: string[]): Promise<MergeOutcome> {
    const photocopy = this.worktreePath;
    const root = this.repoRoot || process.cwd();
    const allowed = [...new Set(files.map(normalizeRepoPath).filter(Boolean))];
    const allowedSet = new Set(allowed);

    gitLog(`commitAndMerge: fotocopia=${photocopy}`);
    gitLog(`commitAndMerge: repo principal=${root} rama=${this.originalBranch || "(desconocida)"}`);
    gitLog(`commitAndMerge: archivos del parche=${allowed.join(", ") || "(ninguno)"}`);

    const porcelain = await runGit(["status", "--porcelain", "-uall"], "status en la FOTOCOPIA (no en master)", {
      cwd: photocopy,
    });
    gitLog(`guard porcelain (fotocopia):\n${porcelain.trim() || "(vacio)"}`);

    const dirty = parsePorcelainPaths(porcelain);
    const extra = [...new Set(dirty.filter((rel) => !allowedSet.has(rel)))];
    if (extra.length > 0) {
      await logOffendingDiffs(photocopy, extra);
      throw new PorcelainGuardError(extra);
    }

    if (allowed.length === 0) {
      gitLog("sin cambios que consolidar: no hay archivos del parche");
      return emptyMergeOutcome();
    }

    await runGit(["add", "--", ...allowed], "git add -- archivos del parche en la FOTOCOPIA", {
      cwd: photocopy,
    });

    const staged = await runGit(["diff", "--cached", "--name-only"], "archivos staged en la FOTOCOPIA", {
      cwd: photocopy,
    });
    gitLog(`guard staged (fotocopia):\n${staged.trim() || "(vacio)"}`);

    const stagedFiles = staged
      .split(/\r?\n/)
      .map((line) => normalizeRepoPath(line.trim()))
      .filter(Boolean);
    const stagedExtra = stagedFiles.filter((rel) => !allowedSet.has(rel));
    if (stagedExtra.length > 0) {
      await logOffendingDiffs(photocopy, stagedExtra);
      throw new PorcelainGuardError(stagedExtra);
    }

    if (stagedFiles.length === 0) {
      gitLog("sin cambios que consolidar: la fotocopia no tiene diff staged");
      return emptyMergeOutcome();
    }

    await runGit(["commit", "-m", message], "commit en la FOTOCOPIA (rama shadow)", {
      cwd: photocopy,
    });

    const incomingRaw = await runGit(
      ["diff", "--name-status", "--no-renames", "HEAD", this.branch],
      "archivos que la fotocopia trae a master",
      { cwd: root }
    );
    const incoming = parseNameStatus(incomingRaw);

    for (const entry of incoming) {
      const rel = entry.path;
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

    const created: string[] = [];
    const edited: string[] = [];
    for (const entry of incoming) {
      if (entry.status === "A") created.push(entry.path);
      else edited.push(entry.path);
    }
    return { merged: true, created, edited };
  }

  async headLog(): Promise<string> {
    const root = this.repoRoot || process.cwd();
    return (await runGit(["log", "-1", "--oneline"], "git log -1 (master/HEAD)", { cwd: root })).trim();
  }

  async diffHead(newFiles: string[] = []): Promise<string> {
    const photocopy = this.worktreePath;
    gitLog("diff HEAD en la FOTOCOPIA");
    gitLog(`  cwd: ${photocopy}`);
    gitLog("  $ git diff HEAD");
    const result = await execa("git", ["diff", "HEAD"], { cwd: photocopy, reject: false });
    const stdout = result.stdout.trim();
    gitLog(stdout.length > 0 ? `  ok stdout:\n${stdout}` : "  ok (sin stdout)");

    const extras: string[] = [];
    for (const rel of [...new Set(newFiles.map(normalizeRepoPath).filter(Boolean))]) {
      const abs = path.join(photocopy, rel);
      if (!existsSync(abs)) continue;
      const tracked = await runGit(["ls-files", "--error-unmatch", "--", rel], `ver si ${rel} esta trackeado`, {
        cwd: photocopy,
        allowFail: true,
      });
      if (tracked.trim().length > 0) continue;
      const diff = await execa("git", ["diff", "--no-index", "--", "/dev/null", rel], {
        cwd: photocopy,
        reject: false,
      });
      if (diff.stdout.trim().length > 0) extras.push(diff.stdout);
    }

    return [result.stdout, ...extras].join("\n");
  }
}

export interface EditBlock {
  kind: "edit";
  filePath: string;
  search: string;
  replace: string;
}

export interface NewFileBlock {
  kind: "new";
  filePath: string;
  content: string;
}

export type ParsedBlock = EditBlock | NewFileBlock;

export type ApplyStrategy =
  | "exact"
  | "normalize-newlines"
  | "ignore-trailing-whitespace"
  | "fuzzy"
  | "rewrite"
  | "new-file";

export interface ApplyResult {
  filePath: string;
  strategy: ApplyStrategy;
}

export function hasFuzzyPatch(applied: ApplyResult[]): boolean {
  return applied.some((result) => result.strategy === "fuzzy");
}

export interface MergeOutcome {
  merged: boolean;
  created: string[];
  edited: string[];
}

export function emptyMergeOutcome(): MergeOutcome {
  return { merged: false, created: [], edited: [] };
}

export interface NameStatusEntry {
  status: string;
  path: string;
}

export function parseNameStatus(output: string): NameStatusEntry[] {
  const entries: NameStatusEntry[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    if (rawLine.trim().length === 0) continue;
    const tab = rawLine.indexOf("\t");
    if (tab === -1) continue;
    const status = rawLine.slice(0, tab).trim().charAt(0).toUpperCase();
    const path = normalizeRepoPath(rawLine.slice(tab + 1).trim());
    if (!status || !path) continue;
    entries.push({ status, path });
  }
  return entries;
}

const FUZZY_THRESHOLD = 0.85;
const SMALL_FILE_CHARS = 1200;

const EDIT_BLOCK_SRC =
  "<<<<<<< SEARCH[^\\n]*\\r?\\n([\\s\\S]*?)\\r?\\n=======[^\\n]*\\r?\\n([\\s\\S]*?)\\r?\\n>>>>>>> REPLACE";

const NEW_FILE_SRC =
  "^[ \\t]*NEW FILE:[ \\t]*([^\\r\\n]+?)[ \\t]*\\r?\\n[ \\t]*<<<[ \\t]*EOF[ \\t]*\\r?\\n([\\s\\S]*?)^[ \\t]*EOF[ \\t]*$";

const BLOCK_RE = new RegExp(`(${EDIT_BLOCK_SRC})|(${NEW_FILE_SRC})`, "gim");

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

export function assertSafeNewPath(raw: string): string {
  const rel = normalizeRepoPath(raw).trim();
  const label = raw.trim().length > 0 ? raw.trim() : "(vacia)";
  if (!rel) {
    throw new Error("NEW FILE con ruta vacia.");
  }
  if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) {
    throw new Error(`NEW FILE con ruta absoluta no permitida: ${label}`);
  }
  if (rel.split("/").includes("..")) {
    throw new Error(`NEW FILE con ".." no permitido: ${label}`);
  }
  if (!/^[\w.@-]+(?:\/[\w.@-]+)*$/.test(rel)) {
    throw new Error(`NEW FILE con ruta invalida: ${label}`);
  }
  return rel;
}

function assertNewFileContent(rel: string, content: string): void {
  if (content.trim().length === 0) {
    throw new Error(`NEW FILE sin contenido: ${rel}`);
  }
}

export function isSafeNewPath(rel: string): boolean {
  try {
    assertSafeNewPath(rel);
    return true;
  } catch {
    return false;
  }
}

export class LLMParser {
  static parse(markdown: string): ParsedBlock[] {
    const blocks: ParsedBlock[] = [];
    const re = new RegExp(BLOCK_RE.source, BLOCK_RE.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(markdown)) !== null) {
      if (match[1] !== undefined) {
        const search = match[2];
        const replace = match[3];
        if (search === undefined || replace === undefined) continue;
        const filePath = extractPathBefore(markdown.slice(0, match.index));
        blocks.push({ kind: "edit", filePath, search, replace });
        continue;
      }
      const rawPath = match[5];
      const content = match[6];
      if (rawPath === undefined || content === undefined) continue;
      const rel = assertSafeNewPath(stripDecor(rawPath));
      assertNewFileContent(rel, content);
      blocks.push({ kind: "new", filePath: rel, content });
    }
    if (blocks.length === 0) {
      throw new Error(
        "No se encontro ningun bloque SEARCH/REPLACE ni NEW FILE valido en la respuesta del modelo."
      );
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
  static preflight(rootDir: string, blocks: ParsedBlock[]): void {
    const created = new Set<string>();
    for (const block of blocks) {
      if (block.kind === "new") {
        const rel = assertSafeNewPath(block.filePath);
        assertNewFileContent(rel, block.content);
        if (created.has(rel)) {
          throw new Error(`NEW FILE duplicado en el mismo parche: ${rel}`);
        }
        const abs = path.join(rootDir, rel);
        if (existsSync(abs)) {
          throw new Error(
            `NEW FILE rechazado: ${rel} ya existe en la fotocopia. Usa SEARCH/REPLACE para editarlo.`
          );
        }
        created.add(rel);
        continue;
      }
      const rel = normalizeRepoPath(block.filePath);
      if (!existsSync(path.join(rootDir, rel))) {
        throw new Error(
          `SEARCH/REPLACE sobre un archivo que no existe: ${rel}. Para crearlo usa un bloque NEW FILE.`
        );
      }
    }
  }

  static apply(rootDir: string, block: ParsedBlock): ApplyResult {
    if (block.kind === "new") {
      return LocalEditor.create(rootDir, block);
    }

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

  private static create(rootDir: string, block: NewFileBlock): ApplyResult {
    const rel = assertSafeNewPath(block.filePath);
    assertNewFileContent(rel, block.content);
    const abs = path.join(rootDir, rel);
    if (existsSync(abs)) {
      throw new Error(
        `NEW FILE rechazado: ${rel} ya existe en la fotocopia. Usa SEARCH/REPLACE para editarlo.`
      );
    }
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, block.content, "utf8");
    return { filePath: rel, strategy: "new-file" };
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
