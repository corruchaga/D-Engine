export const DEFAULT_AGENT_TOKEN_ESTIMATE = 93000;

export interface PhaseTimings {
  selectionMs: number;
  proposalMs: number[];
  gateMs: number[];
  tscMs: number[];
  mergeMs: number;
}

export function createPhaseTimings(): PhaseTimings {
  return { selectionMs: 0, proposalMs: [], gateMs: [], tscMs: [], mergeMs: 0 };
}

export function resolveAgentTokenEstimate(raw?: string): number {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AGENT_TOKEN_ESTIMATE;
  return Math.trunc(parsed);
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatTokens(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function firstLines(text: string, maxLines = 2, maxChars = 200): string[] {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return ["(sin detalle)"];
  const errors = lines.filter((line) => /\berror\b/i.test(line));
  const chosen = (errors.length > 0 ? errors : lines).slice(0, Math.max(1, maxLines));
  return chosen.map((line) => (line.length > maxChars ? `${line.slice(0, maxChars - 3)}...` : line));
}

export function engineMs(timings: PhaseTimings): number {
  let total = timings.selectionMs + timings.mergeMs;
  for (const value of timings.proposalMs) total += value;
  for (const value of timings.gateMs) total += value;
  return total;
}

export function timingLines(timings: PhaseTimings, sessionMs: number): string[] {
  const lines: string[] = [`Seleccion P9: ${formatSeconds(timings.selectionMs)}`];
  const attempts = Math.max(timings.proposalMs.length, timings.gateMs.length);
  for (let i = 0; i < attempts; i++) {
    const proposal = formatSeconds(timings.proposalMs[i] ?? 0);
    const gate = formatSeconds(timings.gateMs[i] ?? 0);
    const tsc = timings.tscMs[i] ?? 0;
    const tscPart = tsc > 0 ? ` (tsc ${formatSeconds(tsc)})` : "";
    lines.push(`Intento ${i + 1} - proposer: ${proposal} - puerta: ${gate}${tscPart}`);
  }
  lines.push(`Merge: ${formatSeconds(timings.mergeMs)}`);
  lines.push(`TOTAL sesion: ${formatSeconds(sessionMs)}`);
  lines.push(`Tiempo de motor (sin esperas humanas): ${formatSeconds(engineMs(timings))}`);
  return lines;
}

export function costComparisonLine(runTokens: number, estimate: number): string {
  const label = formatTokens(estimate);
  if (runTokens <= 0) {
    return `Coste estimado: un agente de bucle habria gastado ~${label} tokens en esta tarea (ratio no calculable: 0 tokens registrados). Estimacion del benchmark (D_ENGINE_AGENT_TOKEN_ESTIMATE), no una medicion.`;
  }
  const ratio = (estimate / runTokens).toFixed(1);
  return `Coste estimado: un agente de bucle habria gastado ~${label} tokens en esta tarea (${ratio}x mas que este run). Estimacion del benchmark (D_ENGINE_AGENT_TOKEN_ESTIMATE), no una medicion.`;
}
