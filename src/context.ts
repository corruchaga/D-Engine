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

function firstLines(content: string, n: number): string {
  return content.split(/\r?\n/).slice(0, n).join("\n");
}

function listSrcTs(root: string): string[] {
  const srcDir = path.join(root, "src");
  if (!existsSync(srcDir)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.endsWith(".ts")) {
        out.push(relFromRoot(root, abs));
      }
    }
  };
  walk(srcDir);
  return out;
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

  const others = listSrcTs(root).filter((rel) => !targetSet.has(rel));
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
