import { execa } from "execa";

export const DEFAULT_DIARY_COMMITS = 5;
export const ABSOLUTE_MAX_DIARY_COMMITS = 20;
export const DIARY_MAX_CHARS = 4000;
export const DIARY_STAT_FILES_MAX = 6;
export const DIARY_MESSAGE_MAX_CHARS = 100;

const RECORD_SEP = "\x1e";
const UNIT_SEP = "\x1f";
const OFF_VALUES = new Set(["0", "false", "off", "no"]);

export interface DiaryCommit {
  hash: string;
  date: string;
  message: string;
  stat: string[];
}

export interface DiaryResult {
  section: string;
  commits: number;
  totalCommits: number;
  truncated: boolean;
  chars: number;
  tokensEstimate: number;
}

export type DiaryGitRunner = (args: string[], cwd: string) => Promise<string>;

export interface DiaryBuildOptions {
  maxCommits: number;
  maxChars?: number;
  runner?: DiaryGitRunner;
}

function diaryLog(message: string): void {
  console.log(`[d-engine:diary] ${message}`);
}

function emptyDiary(): DiaryResult {
  return { section: "", commits: 0, totalCommits: 0, truncated: false, chars: 0, tokensEstimate: 0 };
}

export function resolveDiaryCommits(configured?: string | number): number {
  const clamp = (value: number): number =>
    Math.max(0, Math.min(ABSOLUTE_MAX_DIARY_COMMITS, Math.trunc(value)));
  if (typeof configured === "number") {
    return Number.isFinite(configured) ? clamp(configured) : DEFAULT_DIARY_COMMITS;
  }
  const raw = (configured ?? "").trim().toLowerCase();
  if (raw.length === 0) return DEFAULT_DIARY_COMMITS;
  if (OFF_VALUES.has(raw)) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DIARY_COMMITS;
  return clamp(parsed);
}

function parseNumstatLine(line: string): string | null {
  const trimmed = line.replace(/\r$/, "");
  if (trimmed.trim().length === 0) return null;
  const parts = trimmed.split("\t");
  if (parts.length < 3) return null;
  const added = (parts[0] ?? "").trim();
  const deleted = (parts[1] ?? "").trim();
  const file = parts.slice(2).join("\t").trim();
  if (!file) return null;
  if (added === "-" || deleted === "-") return `${file} (bin)`;
  return `${file} +${added} -${deleted}`;
}

export function parseDiaryLog(raw: string): DiaryCommit[] {
  const commits: DiaryCommit[] = [];
  for (const chunk of raw.split(RECORD_SEP)) {
    const lines = chunk.split(/\r?\n/);
    const headerIndex = lines.findIndex((line) => line.trim().length > 0);
    if (headerIndex === -1) continue;
    const fields = (lines[headerIndex] ?? "").split(UNIT_SEP);
    const hash = (fields[0] ?? "").trim();
    const date = (fields[1] ?? "").trim();
    const message = (fields[2] ?? "").replace(/\r$/, "").trim();
    if (!hash) continue;
    const stat: string[] = [];
    for (const line of lines.slice(headerIndex + 1)) {
      const entry = parseNumstatLine(line);
      if (entry) stat.push(entry);
    }
    commits.push({ hash, date, message, stat });
  }
  return commits;
}

export function formatDiaryCommit(commit: DiaryCommit): string {
  const message =
    commit.message.length > DIARY_MESSAGE_MAX_CHARS
      ? `${commit.message.slice(0, DIARY_MESSAGE_MAX_CHARS - 3)}...`
      : commit.message;
  const lines = [`[${commit.hash}] ${commit.date} ${message}`];
  const shown = commit.stat.slice(0, DIARY_STAT_FILES_MAX);
  for (const entry of shown) lines.push(`  ${entry}`);
  const extra = commit.stat.length - shown.length;
  if (extra > 0) lines.push(`  ... (+${extra} archivos mas)`);
  return lines.join("\n");
}

function assembleDiary(blocks: string[], note: string | null, requested: number): string {
  const header = `--- DIARIO (ultimos ${requested} commits de estos archivos) ---`;
  const footer = "--- FIN DIARIO ---";
  const parts = [header, ...blocks];
  if (note) parts.push(note);
  parts.push(footer);
  return parts.join("\n");
}

export function buildDiarySection(
  commits: DiaryCommit[],
  requested: number,
  maxChars: number = DIARY_MAX_CHARS
): { section: string; commits: number; totalCommits: number; truncated: boolean } {
  const total = commits.length;
  if (total === 0) return { section: "", commits: 0, totalCommits: 0, truncated: false };

  for (let count = total; count > 0; count--) {
    const blocks = commits.slice(0, count).map(formatDiaryCommit);
    const truncated = count < total;
    const note = truncated ? `(diario truncado: se muestran ${count} de ${total} commits)` : null;
    const section = assembleDiary(blocks, note, requested);
    if (section.length <= maxChars) {
      return { section, commits: count, totalCommits: total, truncated };
    }
  }
  return { section: "", commits: 0, totalCommits: total, truncated: true };
}

async function defaultRunner(args: string[], cwd: string): Promise<string> {
  const result = await execa("git", args, { cwd });
  return result.stdout;
}

export async function buildDiary(
  cwd: string,
  files: string[],
  options: DiaryBuildOptions
): Promise<DiaryResult> {
  if (options.maxCommits <= 0) return emptyDiary();
  const paths = files.map((file) => file.replaceAll("\\", "/")).filter((file) => file.length > 0);
  if (paths.length === 0) return emptyDiary();

  const args = [
    "-c",
    "core.quotepath=false",
    "--literal-pathspecs",
    "log",
    "--no-merges",
    "-n",
    String(options.maxCommits),
    "--date=short",
    `--pretty=format:%x1e%h%x1f%ad%x1f%s`,
    "--numstat",
    "--",
    ...paths,
  ];

  const runner = options.runner ?? defaultRunner;
  diaryLog(`$ git ${args.join(" ")}`);
  diaryLog(`  cwd: ${cwd}`);

  let raw: string;
  try {
    raw = await runner(args, cwd);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`git no pudo leer el historial: ${reason}`);
  }

  const commits = parseDiaryLog(raw);
  if (commits.length === 0) return emptyDiary();

  const built = buildDiarySection(commits, options.maxCommits, options.maxChars ?? DIARY_MAX_CHARS);
  if (built.section.length === 0) return emptyDiary();

  const tokensEstimate = Math.ceil(built.section.length / 4);
  const result: DiaryResult = {
    section: built.section,
    commits: built.commits,
    totalCommits: built.totalCommits,
    truncated: built.truncated,
    chars: built.section.length,
    tokensEstimate,
  };
  diaryLog(
    `${built.commits} commit(s) de ${built.totalCommits}, ${result.chars} chars (~${tokensEstimate} tokens)`
  );
  diaryLog("seccion inyectada en el prompt del proposer:");
  diaryLog(built.section);
  return result;
}
