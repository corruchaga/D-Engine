export function normalizeRel(rel: string): string {
  return rel.replaceAll("\\", "/").replace(/^\.\//, "").trim();
}

export function isSafeNewPath(rel: string): boolean {
  const p = normalizeRel(rel);
  if (!p) return false;
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return false;
  const segments = p.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  return /^[\w.@-]+(?:\/[\w.@-]+)*$/.test(p);
}

function uniqNormalize(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of paths) {
    const rel = normalizeRel(item);
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    out.push(rel);
  }
  return out;
}

function tryJsonStringArray(raw: string): string[] | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data) || data.length === 0) return null;
    if (!data.every((item) => typeof item === "string")) return null;
    const paths = uniqNormalize(data);
    return paths.length > 0 ? paths : null;
  } catch {
    return null;
  }
}

function looksLikePath(value: string): boolean {
  const rel = normalizeRel(value);
  if (!rel || /\s/.test(rel)) return false;
  return /^[\w.@-]+(?:\/[\w.@-]+)*$/.test(rel);
}

function stripFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export function parseSelectorResponse(text: string): string[] | null {
  const stripped = stripFence(text);
  if (!stripped) return null;

  const direct = tryJsonStringArray(stripped);
  if (direct) return direct;

  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start !== -1 && end > start) {
    const sliced = tryJsonStringArray(stripped.slice(start, end + 1));
    if (sliced) return sliced;
  }

  const lines: string[] = [];
  for (const line of stripped.split(/\r?\n/)) {
    let token = line.trim();
    if (!token) continue;
    token = token.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "");
    token = token.replace(/^["'`]+|["'`]+$/g, "").trim().replace(/,$/, "");
    if (!looksLikePath(token)) continue;
    lines.push(token);
  }
  const paths = uniqNormalize(lines);
  return paths.length > 0 ? paths : null;
}

export function validateSelectorPaths(
  paths: string[],
  candidates: string[]
): { ok: true; paths: string[] } | { ok: false; reason: string; invalid: string[] } {
  const allowed = new Set(candidates.map(normalizeRel));
  const seen = new Set<string>();
  const out: string[] = [];
  const invalid: string[] = [];
  for (const item of paths) {
    const rel = normalizeRel(item);
    if (!rel || !allowed.has(rel)) {
      invalid.push(rel || item);
      continue;
    }
    if (seen.has(rel)) continue;
    seen.add(rel);
    out.push(rel);
  }
  if (invalid.length > 0) {
    return { ok: false, reason: `no existen / fuera de catalogo: ${invalid.join(", ")}`, invalid };
  }
  if (out.length === 0) {
    return { ok: false, reason: "formato invalido", invalid: [] };
  }
  return { ok: true, paths: out };
}

export function resolveSelectorPaths(
  text: string,
  candidates: string[],
  options: { allowNew?: boolean } = {}
): { ok: true; paths: string[]; newPaths: string[] } | { ok: false; reason: string; invalid: string[] } {
  const parsed = parseSelectorResponse(text);
  if (!parsed) return { ok: false, reason: "formato invalido", invalid: [] };

  const strict = validateSelectorPaths(parsed, candidates);
  if (strict.ok) return { ok: true, paths: strict.paths, newPaths: [] };
  if (!options.allowNew) return strict;

  const known = new Set(candidates.map(normalizeRel));
  const kept: string[] = [];
  const newPaths: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const rel = normalizeRel(item);
    if (!rel) {
      invalid.push(item);
      continue;
    }
    if (seen.has(rel)) continue;
    if (known.has(rel)) {
      seen.add(rel);
      kept.push(rel);
      continue;
    }
    if (rel.startsWith("src/") && isSafeNewPath(rel)) {
      seen.add(rel);
      newPaths.push(rel);
      continue;
    }
    invalid.push(rel);
  }

  if (invalid.length > 0) {
    return { ok: false, reason: `no existen / fuera de catalogo: ${invalid.join(", ")}`, invalid };
  }
  if (kept.length + newPaths.length === 0) {
    return { ok: false, reason: "formato invalido", invalid: [] };
  }
  return { ok: true, paths: [...kept, ...newPaths], newPaths };
}
