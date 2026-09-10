import { execa } from "execa";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function contextLog(message: string): void {
  console.log(`[d-engine:context] ${message}`);
}

function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

function relFromRoot(root: string, file: string): string {
  return toPosix(path.relative(root, path.resolve(root, file)));
}

const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git"]);
const SELECTOR_SUMMARY_LINES = 3;
const SELECTOR_LINE_MAX = 80;
export const SELECTOR_CATALOG_MAX_CHARS = 2200;

function firstLines(content: string, n: number): string {
  return content.split(/\r?\n/).slice(0, n).join("\n");
}

export function isTestSourceFile(rel: string): boolean {
  const base = path.posix.basename(toPosix(rel));
  return /\.(test|spec)\.ts$/i.test(base) || /^test-/i.test(base);
}

export function listSourceFiles(root: string): string[] {
  const srcDir = path.join(root, "src");
  if (!existsSync(srcDir)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(abs);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        out.push(relFromRoot(root, abs));
      }
    }
  };
  walk(srcDir);
  return out;
}

function promptTokens(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter((token) => token.length >= 2);
}

function scoreRel(rel: string, snippet: string, tokens: string[]): number {
  const hay = `${rel}\n${snippet}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (hay.includes(token)) score += 1;
    if (rel.toLowerCase().includes(token)) score += 2;
  }
  return score;
}

export function fileSelectorSnippet(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, SELECTOR_SUMMARY_LINES)
    .map((line) => line.slice(0, SELECTOR_LINE_MAX))
    .join("\n");
}

export interface SelectorCatalogFile {
  rel: string;
  snippet: string;
  ts: number;
  isTest: boolean;
  score: number;
}

function formatCatalogEntry(rel: string, snippet: string): string {
  return snippet.length > 0 ? `# ${rel}\n${snippet}` : `# ${rel}`;
}

export function packSelectorCatalog(
  files: SelectorCatalogFile[],
  maxChars: number = SELECTOR_CATALOG_MAX_CHARS
): { text: string; candidates: string[] } {
  const candidates = files.map((file) => file.rel);
  const ranked = [...files].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.isTest !== b.isTest) return a.isTest ? 1 : -1;
    if (b.ts !== a.ts) return b.ts - a.ts;
    return a.rel.localeCompare(b.rel);
  });

  const parts: string[] = [];
  let used = 0;
  let i = 0;
  for (; i < ranked.length; i++) {
    const file = ranked[i];
    if (!file) continue;
    const block = formatCatalogEntry(file.rel, file.snippet);
    const sep = parts.length > 0 ? 2 : 0;
    if (used + sep + block.length > maxChars) break;
    parts.push(block);
    used += sep + block.length;
  }

  const leftover = ranked.slice(i).map((item) => item.rel);
  if (leftover.length > 0) {
    const sep = parts.length > 0 ? 2 : 0;
    const room = maxChars - used - sep;
    if (room > 8) {
      let otros = `OTROS: ${leftover.join(", ")}`;
      if (otros.length > room) otros = `${otros.slice(0, Math.max(0, room - 3))}...`;
      parts.push(otros);
    }
  }

  return { text: parts.join("\n\n"), candidates };
}

export async function buildSelectorCatalog(
  prompt: string,
  options: { root?: string; maxChars?: number } = {}
): Promise<{ text: string; candidates: string[] }> {
  const root = options.root ?? process.cwd();
  const maxChars = options.maxChars ?? SELECTOR_CATALOG_MAX_CHARS;
  const tokens = promptTokens(prompt);
  const rels = listSourceFiles(root);
  const files: SelectorCatalogFile[] = await Promise.all(
    rels.map(async (rel) => {
      const snippet = fileSelectorSnippet(readFileSync(path.join(root, rel), "utf8"));
      return {
        rel,
        snippet,
        ts: await lastCommitTs(root, rel),
        isTest: isTestSourceFile(rel),
        score: scoreRel(rel, snippet, tokens),
      };
    })
  );
  return packSelectorCatalog(files, maxChars);
}

async function lastCommitTs(root: string, relFile: string): Promise<number> {
  const result = await execa("git", ["log", "-1", "--format=%ct", "--", relFile], {
    cwd: root,
    reject: false,
  });
  const ts = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
}

export async function buildContext(targetFiles: string[]): Promise<string> {
  const root = process.cwd();
  const parts: string[] = [];
  const order: string[] = [];
  const targetRels = targetFiles.map((file) => relFromRoot(root, file));
  const targetSet = new Set(targetRels);

  const decisionsPath = path.join(root, "DECISIONS.md");
  if (existsSync(decisionsPath)) {
    const decisions = readFileSync(decisionsPath, "utf8");
    parts.push(`# Decisiones del proyecto (inmutables)\n\n${decisions.trimEnd()}`);
    order.push("DECISIONS.md");
  }

  const others = listSourceFiles(root).filter((rel) => !targetSet.has(rel));
  const dated = await Promise.all(
    others.map(async (rel) => ({ rel, ts: await lastCommitTs(root, rel) }))
  );
  dated.sort((a, b) => a.ts - b.ts || a.rel.localeCompare(b.rel));

  for (const { rel } of dated) {
    const summary = firstLines(readFileSync(path.join(root, rel), "utf8"), 30);
    parts.push(`# ${rel}\n\n${summary}`);
    order.push(rel);
  }

  for (const rel of targetRels) {
    const targetContent = readFileSync(path.join(root, rel), "utf8");
    parts.push(`# ${rel}\n\n${targetContent}`);
    order.push(rel);
  }

  const context = parts.join("\n\n");
  contextLog(`orden: ${order.join(" -> ")}`);
  contextLog(`size: ${context.length} chars`);
  return context;
}
