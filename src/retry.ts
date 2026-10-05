export const DEFAULT_MAX_RETRIES = 2;
export const ABSOLUTE_MAX_RETRIES = 5;
export const TSC_OUTPUT_MAX_LINES = 60;
export const TSC_OUTPUT_MAX_CHARS = 4000;

export type RejectionKind = "format" | "path" | "materialization" | "compile" | "audit";

export interface GateRejection {
  kind: RejectionKind;
  reason: string;
  output?: string;
}

export interface RetryProposal {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export type GateResult<T> = { ok: true; value: T } | { ok: false; rejection: GateRejection };

export type AttemptStatus = "consolidated" | "rejected";

export interface RetryAttempt {
  index: number;
  tokensIn: number;
  tokensOut: number;
  status: AttemptStatus;
  rejection?: GateRejection;
}

export interface RetryFeedback {
  previousText: string;
  message: string;
}

export type ProposeFn = (feedback?: RetryFeedback) => Promise<RetryProposal>;
export type GateFn<T> = (proposal: RetryProposal, attemptIndex: number) => Promise<GateResult<T>>;

export type RetryOutcome<T> =
  | { ok: true; value: T; attempts: RetryAttempt[]; retries: number }
  | { ok: false; attempts: RetryAttempt[]; retries: number; lastRejection: GateRejection };

export interface BoundedRetryOptions<T> {
  maxRetries: number;
  propose: ProposeFn;
  gate: GateFn<T>;
}

export function resolveMaxRetries(configured?: string | number): number {
  const raw = typeof configured === "number" ? configured : Number.parseInt((configured ?? "").trim(), 10);
  const base = Number.isFinite(raw) ? raw : DEFAULT_MAX_RETRIES;
  return Math.max(0, Math.min(ABSOLUTE_MAX_RETRIES, Math.trunc(base)));
}

export function resolveFuzzyVerify(configured?: string): boolean {
  const raw = (configured ?? "").trim().toLowerCase();
  if (raw.length === 0) return true;
  return !["0", "false", "off", "no"].includes(raw);
}

export function truncateToolOutput(output: string): string {
  const lines = output.replace(/\r\n/g, "\n").split("\n");
  const errors = lines.filter((line) => /\berror\b/i.test(line));
  const chosen = errors.length > 0 ? errors : lines;
  let truncated = chosen.length > TSC_OUTPUT_MAX_LINES;
  let text = chosen.slice(0, TSC_OUTPUT_MAX_LINES).join("\n");
  if (text.length > TSC_OUTPUT_MAX_CHARS) {
    text = text.slice(0, TSC_OUTPUT_MAX_CHARS);
    truncated = true;
  }
  if (truncated) {
    text += `\n... (salida truncada: ${chosen.length} lineas, max ${TSC_OUTPUT_MAX_LINES})`;
  }
  return text.length > 0 ? text : "(sin output)";
}

export function buildGateFeedback(rejection: GateRejection): string {
  switch (rejection.kind) {
    case "compile":
      return [
        "la compilacion (tsc --noEmit) fallo; tu intento anterior NO se consolido.",
        "Los archivos estan en su estado original: usa SEARCH/REPLACE para los existentes y NEW FILE para los que no existen (recrea con NEW FILE los que hayan sido nuevos).",
        "Corrige EXACTAMENTE estos errores de tsc (archivo y linea):",
        truncateToolOutput(rejection.output ?? rejection.reason),
      ].join("\n");
    case "materialization":
      return [
        "no se pudo materializar el parche en la fotocopia; tu intento anterior NO se consolido.",
        rejection.reason,
        "Corrige el tipo de bloque: usa NEW FILE solo para archivos que no existen y SEARCH/REPLACE para archivos existentes.",
        "Responde solo con bloques validos.",
      ].join("\n");
    case "path":
      return [
        "el archivo de tu bloque no es un objetivo; tu intento anterior NO se consolido.",
        rejection.reason,
        "Responde solo con bloques para las rutas de archivo objetivo indicadas.",
      ].join("\n");
    case "format":
      return [
        "tu respuesta no contenía bloques SEARCH/REPLACE ni NEW FILE válidos; responde solo con bloques.",
        rejection.reason,
      ].join("\n");
    case "audit":
      return [
        "la compilacion paso, pero la auditoria semantica automatica rechazo el resultado (se disparo porque tu parche solo se pudo aplicar por aproximacion fuzzy); tu intento anterior NO se consolido.",
        "Motivo de la auditoria:",
        truncateToolOutput(rejection.reason),
        "Rehaz el parche con el texto EXACTO del archivo objetivo (SEARCH identico al archivo) y corrige lo senalado.",
      ].join("\n");
  }
}

export async function runBoundedRetry<T>(options: BoundedRetryOptions<T>): Promise<RetryOutcome<T>> {
  const maxRetries = Math.max(0, Math.trunc(options.maxRetries));
  const attempts: RetryAttempt[] = [];
  let feedback: RetryFeedback | undefined;

  for (let i = 0; i <= maxRetries; i++) {
    const proposal = await options.propose(feedback);
    const result = await options.gate(proposal, i + 1);
    if (result.ok) {
      attempts.push({
        index: i + 1,
        tokensIn: proposal.tokensIn,
        tokensOut: proposal.tokensOut,
        status: "consolidated",
      });
      return { ok: true, value: result.value, attempts, retries: attempts.length - 1 };
    }
    attempts.push({
      index: i + 1,
      tokensIn: proposal.tokensIn,
      tokensOut: proposal.tokensOut,
      status: "rejected",
      rejection: result.rejection,
    });
    feedback = { previousText: proposal.text, message: buildGateFeedback(result.rejection) };
  }

  const last = attempts[attempts.length - 1];
  const lastRejection: GateRejection = last?.rejection ?? { kind: "format", reason: "sin intentos ejecutados" };
  return { ok: false, attempts, retries: attempts.length - 1, lastRejection };
}

export interface LlmCalls {
  selector: number;
  proposal: number;
  retries: number;
  audit: number;
}

export function llmTotal(calls: LlmCalls): number {
  return calls.selector + calls.proposal + calls.retries + calls.audit;
}

export function formatLlmCalls(calls: LlmCalls): string {
  const parts: string[] = [];
  if (calls.selector > 0) parts.push(`selector ${calls.selector}`);
  if (calls.proposal > 0) parts.push(`propuesta ${calls.proposal}`);
  if (calls.retries > 0) parts.push(`reintentos ${calls.retries}`);
  if (calls.audit > 0) parts.push(`auditoria ${calls.audit}`);
  const detail = parts.length > 0 ? ` (${parts.join(" + ")})` : "";
  return `Llamadas LLM: ${llmTotal(calls)}${detail}`;
}

export interface TokenTotals {
  in: number;
  out: number;
  total: number;
}

export function sumTokens(attempts: RetryAttempt[]): TokenTotals {
  let tokensIn = 0;
  let tokensOut = 0;
  for (const attempt of attempts) {
    tokensIn += attempt.tokensIn;
    tokensOut += attempt.tokensOut;
  }
  return { in: tokensIn, out: tokensOut, total: tokensIn + tokensOut };
}

export function rejectionLabel(kind: RejectionKind): string {
  switch (kind) {
    case "format":
      return "rechazado (bloques invalidos)";
    case "path":
      return "rechazado (ruta fuera de objetivo)";
    case "materialization":
      return "rechazado (no se pudo materializar)";
    case "compile":
      return "rechazado por la puerta (tsc)";
    case "audit":
      return "rechazado por la auditoria (semantica)";
  }
}

export function attemptLines(attempts: RetryAttempt[]): string[] {
  return attempts.map((attempt) => {
    const tokens = `${attempt.tokensIn + attempt.tokensOut} tok (in ${attempt.tokensIn} + out ${attempt.tokensOut})`;
    const status =
      attempt.status === "consolidated"
        ? "consolidado (puerta OK)"
        : rejectionLabel(attempt.rejection?.kind ?? "format");
    return `Intento ${attempt.index}: ${tokens} — ${status}`;
  });
}
