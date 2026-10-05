#!/usr/bin/env node
import { intro, outro, text, select, confirm, spinner, log, cancel, isCancel } from "@clack/prompts";
import { copyFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import pc from "picocolors";
import {
  LLMParser,
  LocalEditor,
  PorcelainGuardError,
  ShadowWorkspace,
  Validator,
  emptyMergeOutcome,
  hasFuzzyPatch,
  type ApplyResult,
  type MergeOutcome,
  type ParsedBlock,
} from "./engine.js";
import { buildSelectorCatalog } from "./context.js";
import {
  parseVerifyVerdict,
  proposeChanges,
  proposeCorrection,
  selectTargetFiles,
  verifyChanges,
} from "./llm.js";
import {
  attemptLines,
  formatLlmCalls,
  llmTotal,
  resolveFuzzyVerify,
  resolveMaxRetries,
  runBoundedRetry,
  sumTokens,
  type GateResult,
  type LlmCalls,
  type RetryProposal,
} from "./retry.js";
import { isSafeNewPath, normalizeRel, resolveSelectorPaths } from "./selector.js";
import {
  costComparisonLine,
  createPhaseTimings,
  firstLines,
  formatSeconds,
  resolveAgentTokenEstimate,
  timingLines,
} from "./telemetry.js";

type SecurityMode = "fast" | "verify" | "shadow";

interface ModeConfig {
  label: string;
  description: string;
  llmCalls: number;
  runShadow: boolean;
  runCompile: boolean;
  runAudit: boolean;
}

const MODES: Record<SecurityMode, ModeConfig> = {
  fast: {
    label: "Fast",
    description: "1 llamada: aplica y consolida directo",
    llmCalls: 1,
    runShadow: false,
    runCompile: false,
    runAudit: false,
  },
  verify: {
    label: "Verify",
    description: "Auditoria semantica con 2da llamada",
    llmCalls: 2,
    runShadow: false,
    runCompile: true,
    runAudit: true,
  },
  shadow: {
    label: "Shadow (1 llamada LLM, no consolida sin tu permiso)",
    description: "1 llamada LLM, no consolida sin tu permiso",
    llmCalls: 1,
    runShadow: true,
    runCompile: true,
    runAudit: false,
  },
};

const DEFAULT_TARGET = "src/demo/calculator.ts";

const llmCalls: LlmCalls = { selector: 0, proposal: 0, retries: 0, audit: 0 };

const llmTokens = { selector: 0, audit: 0 };

const timings = createPhaseTimings();

function tokenSummary(attemptTokens: number): string {
  const parts = [`intentos ${attemptTokens}`];
  if (llmTokens.selector > 0) parts.push(`selector ${llmTokens.selector}`);
  if (llmTokens.audit > 0) parts.push(`auditoria ${llmTokens.audit}`);
  const total = attemptTokens + llmTokens.selector + llmTokens.audit;
  return `${total} (${parts.join(" + ")})`;
}

function handleCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Operacion cancelada.");
    process.exit(0);
  }
  return value as T;
}

interface SpinnerLike {
  start: (msg?: string) => void;
  stop: (msg?: string, code?: number) => void;
}

async function createShadow(spin: SpinnerLike, ws: ShadowWorkspace): Promise<string> {
  spin.start("Creando fotocopia (git worktree)...");
  try {
    return await ws.create();
  } finally {
    spin.stop();
  }
}

async function destroyShadow(spin: SpinnerLike, ws: ShadowWorkspace): Promise<void> {
  spin.start("Destruyendo fotocopia (rollback)...");
  try {
    await ws.destroy();
  } finally {
    spin.stop();
  }
}

function linkNodeModules(worktreePath: string): void {
  const src = path.join(process.cwd(), "node_modules");
  const dest = path.join(worktreePath, "node_modules");
  if (!existsSync(src) || existsSync(dest)) return;
  symlinkSync(src, dest, process.platform === "win32" ? "junction" : "dir");
}

function ensureDemoFile(worktreePath: string, rel: string): void {
  const dest = path.join(worktreePath, rel);
  if (existsSync(dest)) return;
  const src = path.join(process.cwd(), rel);
  if (!existsSync(src)) return;
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

function withNormalizedPaths(blocks: ParsedBlock[]): ParsedBlock[] {
  return blocks.map((block) => ({ ...block, filePath: normalizeRel(block.filePath) }));
}

function isNewTarget(rel: string): boolean {
  return !existsSync(path.resolve(process.cwd(), rel));
}

function formatTargets(rels: string[]): string {
  return rels.map((rel) => (isNewTarget(rel) ? `${rel} ${pc.yellow("(NUEVO)")}` : rel)).join(", ");
}

function logApplied(results: ApplyResult[]): void {
  for (const result of results) {
    if (result.strategy === "new-file") {
      log.success(pc.green(`Archivo creado ${result.filePath} (new-file)`));
    } else {
      log.success(pc.green(`Parche aplicado en ${result.filePath} (${result.strategy})`));
    }
  }
}

function parseTargets(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(",")) {
    const rel = normalizeRel(part.trim());
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    out.push(rel);
  }
  return out;
}

function validateTargetInput(value: string): string | undefined {
  const rels = parseTargets(value);
  if (rels.length === 0) return "Indica al menos un archivo.";
  const unsafe = rels.filter((rel) => !isSafeNewPath(rel));
  if (unsafe.length > 0) {
    return `Ruta invalida (debe ser relativa, sin ".."): ${unsafe.join(", ")}`;
  }
  const missing = rels.filter((rel) => isNewTarget(rel));
  if (missing.length > 0) {
    log.info(pc.dim("Archivos nuevos a crear: ") + pc.yellow(missing.join(", ")));
  }
  return undefined;
}

async function askManualTargets(prefill?: string): Promise<string[]> {
  const targetRaw = handleCancel(
    await text({
      message: "¿Archivo objetivo?",
      placeholder: DEFAULT_TARGET,
      defaultValue: prefill && prefill.length > 0 ? prefill : DEFAULT_TARGET,
      validate: (value) => validateTargetInput(value ?? ""),
    })
  );
  return parseTargets(String(targetRaw));
}

async function resolveTargetFiles(promptText: string): Promise<string[]> {
  const targetRaw = handleCancel(
    await text({
      message: "¿Archivo objetivo? (Enter vacio = seleccion automatica)",
      placeholder: "vacio = auto  ·  src/foo.ts, src/bar.ts",
      validate: (value) => {
        const v = (value ?? "").trim();
        if (v.length === 0) return;
        return validateTargetInput(v);
      },
    })
  );
  const typed = String(targetRaw).trim();
  if (typed.length > 0) return parseTargets(typed);

  const spin = spinner();
  const selectionStart = performance.now();
  let selectionRecorded = false;
  const recordSelection = (): void => {
    if (selectionRecorded) return;
    selectionRecorded = true;
    timings.selectionMs += performance.now() - selectionStart;
  };
  spin.start("Seleccionando archivos objetivo...");
  let catalog: { text: string; candidates: string[] };
  try {
    catalog = await buildSelectorCatalog(promptText);
  } catch {
    spin.stop();
    recordSelection();
    log.warn("No se pudo construir el catalogo. Elige archivos a mano.");
    return askManualTargets();
  }
  if (catalog.candidates.length === 0) {
    spin.stop();
    recordSelection();
    log.warn("No hay archivos candidatos. Elige archivos a mano.");
    return askManualTargets();
  }

  try {
    let result = await selectTargetFiles(promptText, catalog.text);
    llmCalls.selector += 1;
    llmTokens.selector += result.tokensIn + result.tokensOut;
    let resolved = resolveSelectorPaths(result.text, catalog.candidates, { allowNew: true });
    if (!resolved.ok) {
      log.warn(`Selector: ${resolved.reason}. Reintentando una vez...`);
      const feedback =
        resolved.reason === "formato invalido"
          ? "formato invalido; responde solo un JSON array de rutas del catalogo o de archivos nuevos bajo src/"
          : `${resolved.reason}; responde solo un JSON array de rutas del catalogo o de archivos nuevos bajo src/`;
      result = await selectTargetFiles(promptText, catalog.text, {
        previousText: result.text,
        feedback,
      });
      llmCalls.selector += 1;
      llmTokens.selector += result.tokensIn + result.tokensOut;
      resolved = resolveSelectorPaths(result.text, catalog.candidates, { allowNew: true });
    }
    spin.stop();
    recordSelection();
    if (!resolved.ok) {
      log.warn("El selector no devolvio rutas validas. Elige archivos a mano.");
      return askManualTargets();
    }
    log.info(pc.dim("Seleccion automatica: ") + formatTargets(resolved.paths));
    const choice = handleCancel(
      await select({
        message: `¿Usar estos archivos?\n${formatTargets(resolved.paths)}`,
        options: [
          { value: "yes", label: "si" },
          { value: "edit", label: "editar manualmente" },
        ],
      })
    );
    if (choice === "edit") return askManualTargets(resolved.paths.join(", "));
    return resolved.paths;
  } catch {
    spin.stop();
    recordSelection();
    log.warn("El selector fallo. Elige archivos a mano.");
    return askManualTargets();
  }
}

function unauthorizedBlockPaths(blocks: ParsedBlock[], targets: string[]): string[] {
  const allowed = new Set(targets);
  return [...new Set(blocks.map((block) => block.filePath).filter((rel) => !allowed.has(rel)))];
}

interface GatedChange {
  applied: ApplyResult[];
}

async function mergeChanges(ws: ShadowWorkspace, message: string, files: string[]): Promise<MergeOutcome> {
  try {
    const outcome = await ws.commitAndMerge(message, files);
    if (outcome.merged) {
      log.success(pc.green("Cambios consolidados en la rama real."));
    } else {
      log.info(pc.dim("Sin cambios que consolidar en la fotocopia."));
    }
    return outcome;
  } catch (error) {
    if (error instanceof PorcelainGuardError) {
      log.error(
        pc.red(
          `La puerta rechazo el cambio: se detectaron modificaciones fuera de los archivos del parche: ${error.files.join(", ")}. Nada se consolida.`
        )
      );
      return emptyMergeOutcome();
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const sessionStart = performance.now();
  intro(pc.bold(pc.cyan("D-Engine")) + pc.dim("  — la IA piensa, la puerta decide."));

  const promptText = handleCancel(
    await text({
      message: "Describe los cambios que quieres aplicar al codigo:",
      placeholder: "p.ej. Renombra la funcion calculate a computeTotal y anade un segundo parametro opcional",
      validate: (value) => {
        const v = value ?? "";
        if (v.trim().length === 0) return "El prompt no puede estar vacio.";
        if (v.trim().length < 10) return "Describe el cambio con mas detalle (min 10 caracteres).";
      },
    })
  );

  const targetRels = await resolveTargetFiles(promptText);

  const modeRaw = handleCancel(
    await select({
      message: "Selecciona el modo de seguridad:",
      options: [
        { value: "fast", label: MODES.fast.label, hint: pc.dim(MODES.fast.description) },
        { value: "verify", label: MODES.verify.label, hint: pc.dim(MODES.verify.description) },
        { value: "shadow", label: MODES.shadow.label, hint: pc.dim(MODES.shadow.description) },
      ],
    })
  );
  const mode = MODES[modeRaw as SecurityMode];

  const shouldRun = handleCancel(
    await confirm({
      message: "Ejecutar ahora?",
      active: "Ejecutar",
      inactive: "Cancelar",
    })
  );

  if (!shouldRun) {
    if (llmTotal(llmCalls) > 0) log.info(pc.dim(formatLlmCalls(llmCalls)));
    cancel("Operacion cancelada.");
    process.exit(0);
  }

  const maxRetries = resolveMaxRetries(process.env.D_ENGINE_MAX_RETRIES);
  const fuzzyVerifyOn = resolveFuzzyVerify(process.env.D_ENGINE_FUZZY_VERIFY);

  log.info(pc.dim("Prompt recibido: ") + pc.white(promptText));
  log.info(pc.dim("Modo de seguridad: ") + pc.magenta(mode.label) + pc.dim(`  (${mode.llmCalls} llamada(s) LLM)`));
  log.info(pc.dim("Archivos objetivo: ") + formatTargets(targetRels));
  log.info(pc.dim("Reintentos max: ") + pc.white(String(maxRetries)) + pc.dim(" (D_ENGINE_MAX_RETRIES)"));
  log.info(
    pc.dim("Auto-auditoria fuzzy: ") +
      (fuzzyVerifyOn ? pc.white("ON") : pc.white("OFF")) +
      pc.dim(" (D_ENGINE_FUZZY_VERIFY)")
  );

  const s = spinner();
  const ws = new ShadowWorkspace();
  let shadowCreated = false;

  try {
    const worktreePath = await createShadow(s, ws);
    shadowCreated = true;
    log.info(pc.dim("Fotocopia creada en: ") + pc.cyan(worktreePath));

    linkNodeModules(worktreePath);

    const evaluateGate = async (
      proposal: RetryProposal
    ): Promise<{ result: GateResult<GatedChange>; tscMs: number }> => {
      let blocks: ParsedBlock[];
      try {
        blocks = withNormalizedPaths(LLMParser.parse(proposal.text));
      } catch (error) {
        return {
          result: {
            ok: false,
            rejection: { kind: "format", reason: error instanceof Error ? error.message : String(error) },
          },
          tscMs: 0,
        };
      }
      const missing = unauthorizedBlockPaths(blocks, targetRels);
      if (missing.length > 0) {
        const wrong = missing[0] ?? "(desconocida)";
        return {
          result: {
            ok: false,
            rejection: {
              kind: "path",
              reason: `el archivo del bloque no es un objetivo (apuntaba a ${wrong}; los objetivos son ${targetRels.join(", ")}).`,
            },
          },
          tscMs: 0,
        };
      }

      await ws.restoreFiles(targetRels);
      let applied: ApplyResult[];
      try {
        for (const block of blocks) ensureDemoFile(worktreePath, block.filePath);
        LocalEditor.preflight(worktreePath, blocks);
        applied = blocks.map((block) => LocalEditor.apply(worktreePath, block));
      } catch (error) {
        return {
          result: {
            ok: false,
            rejection: {
              kind: "materialization",
              reason: error instanceof Error ? error.message : String(error),
            },
          },
          tscMs: 0,
        };
      }

      const tscStart = performance.now();
      const check = await Validator.run(worktreePath);
      const tscMs = performance.now() - tscStart;
      if (!check.ok) {
        return {
          result: { ok: false, rejection: { kind: "compile", reason: check.output, output: check.output } },
          tscMs,
        };
      }
      return { result: { ok: true, value: { applied } }, tscMs };
    };

    let fuzzyAuditUnavailable = 0;
    let mergeOutcome: MergeOutcome = emptyMergeOutcome();

    const gate = async (proposal: RetryProposal, attemptIndex: number): Promise<GateResult<GatedChange>> => {
      const attemptStart = performance.now();
      s.start(`Intento ${attemptIndex}: materializando y compilando (tsc)...`);
      const evaluated = await evaluateGate(proposal).finally(() => s.stop());
      timings.tscMs.push(evaluated.tscMs);
      const tokens = proposal.tokensIn + proposal.tokensOut;

      if (!evaluated.result.ok) {
        const rejection = evaluated.result.rejection;
        const gateMs = performance.now() - attemptStart;
        timings.gateMs.push(gateMs);
        timings.auditMs.push(0);
        log.error(
          pc.red(`Intento ${attemptIndex} rechazado [${rejection.kind}] - ${tokens} tok - ${formatSeconds(gateMs)}`)
        );
        for (const line of firstLines(rejection.output ?? rejection.reason)) {
          log.info(pc.dim(`  ${line}`));
        }
        return evaluated.result;
      }

      const okResult = evaluated.result;
      log.success(
        pc.green(
          `Intento ${attemptIndex}: puerta OK (tsc en verde) - ${tokens} tok - ${formatSeconds(performance.now() - attemptStart)}`
        )
      );

      let result: GateResult<GatedChange> = okResult;
      if (fuzzyVerifyOn && !mode.runAudit && hasFuzzyPatch(okResult.value.applied)) {
        log.info(pc.yellow("Parche aplicado por fuzzy -> auditoria semantica automatica"));
        s.start(`Intento ${attemptIndex}: auditoria semantica automatica...`);
        const auditStart = performance.now();
        let audit: RetryProposal | null = null;
        let auditError = "";
        try {
          const diff = await ws.diffHead([...new Set(okResult.value.applied.map((r) => r.filePath))]);
          audit = await verifyChanges(promptText, diff);
        } catch (error) {
          auditError = error instanceof Error ? error.message : String(error);
        }
        const auditMs = performance.now() - auditStart;
        timings.auditMs.push(auditMs);
        timings.gateMs.push(performance.now() - attemptStart);
        s.stop();

        if (audit === null) {
          fuzzyAuditUnavailable = okResult.value.applied.filter((r) => r.strategy === "fuzzy").length;
          log.warn(pc.yellow("Auditoria no disponible (error de red) - el parche fuzzy sigue sin auditar"));
          log.info(pc.dim(`  ${auditError}`));
          return result;
        }

        llmCalls.audit += 1;
        llmTokens.audit += audit.tokensIn + audit.tokensOut;
        const verdict = parseVerifyVerdict(audit.text);
        if (verdict.ok) {
          if (verdict.reason) {
            log.success(pc.green("Auditoria automatica OK_CON_OBSERVACIONES: ") + verdict.reason);
          } else {
            log.success(pc.green("Auditoria automatica OK: el diff cumple el requisito."));
          }
          return result;
        }

        result = { ok: false, rejection: { kind: "audit", reason: verdict.reason || audit.text.trim() } };
        log.error(pc.red("Auditoria automatica FALLO: ") + result.rejection.reason);
        log.error(
          pc.red(
            `Intento ${attemptIndex} rechazado [${result.rejection.kind}] - ${tokens} tok - ${formatSeconds(
              performance.now() - attemptStart
            )}`
          )
        );
        for (const line of firstLines(result.rejection.reason)) {
          log.info(pc.dim(`  ${line}`));
        }
        return result;
      }

      timings.auditMs.push(0);
      timings.gateMs.push(performance.now() - attemptStart);
      return result;
    };

    let proposalIndex = 0;
    const propose = async (feedback?: { previousText: string; message: string }) => {
      proposalIndex += 1;
      s.start(`Intento ${proposalIndex}: proponiendo${feedback ? " correccion" : ""}...`);
      const proposeStart = performance.now();
      try {
        if (feedback) {
          llmCalls.retries += 1;
          return await proposeCorrection(promptText, targetRels, feedback.previousText, feedback.message);
        }
        llmCalls.proposal += 1;
        return await proposeChanges(promptText, targetRels);
      } finally {
        timings.proposalMs.push(performance.now() - proposeStart);
        s.stop();
      }
    };

    const outcome = await runBoundedRetry<GatedChange>({ maxRetries, propose, gate });

    for (const line of attemptLines(outcome.attempts)) {
      log.info(pc.dim(line));
    }

    let applied: ApplyResult[] = [];
    if (!outcome.ok) {
      log.error(
        pc.red(`La puerta rechazo el cambio tras ${outcome.attempts.length} intento(s). Nada se consolida.`)
      );
      const output = outcome.lastRejection.output ?? outcome.lastRejection.reason;
      if (output.trim().length > 0) {
        log.message(output);
      }
    } else {
      applied = outcome.value.applied;
      logApplied(applied);
      log.success(pc.green("Compilacion OK: la fotocopia es valida."));

      let auditOk = true;
      if (mode.runAudit) {
        s.start("Auditoria semantica (2da llamada LLM)...");
        const diff = await ws.diffHead([...new Set(applied.map((result) => result.filePath))]);
        const audit = await verifyChanges(promptText, diff);
        llmCalls.audit += 1;
        llmTokens.audit += audit.tokensIn + audit.tokensOut;
        s.stop();
        const verdict = parseVerifyVerdict(audit.text);
        if (verdict.ok) {
          if (verdict.reason) {
            log.success(pc.green("Auditoria OK_CON_OBSERVACIONES: ") + verdict.reason);
          } else {
            log.success(pc.green("Auditoria OK: el diff cumple el requisito."));
          }
        } else {
          auditOk = false;
          log.error(pc.red("Auditoria FALLO: ") + (verdict.reason || audit.text.trim()));
          log.info(pc.dim("Nada se consolida."));
        }
      }

      if (!auditOk) {
        log.info(pc.dim("Puerta semantica rechazo el cambio."));
      } else if (mode.runShadow) {
        const diff = await ws.diffHead([...new Set(applied.map((result) => result.filePath))]);
        if (diff.trim().length > 0) {
          log.message(diff);
        } else {
          log.info(pc.dim("(sin cambios)"));
        }

        const consolidate = handleCancel(
          await confirm({
            message: "¿Consolidar? (sí/no)",
            active: "sí",
            inactive: "no",
          })
        );

        if (consolidate) {
          const mergeStart = performance.now();
          mergeOutcome = await mergeChanges(ws, "D-Engine: cambios consolidados en modo shadow", [
            ...new Set(applied.map((result) => result.filePath)),
          ]);
          timings.mergeMs += performance.now() - mergeStart;
        } else {
          await destroyShadow(s, ws);
          shadowCreated = false;
          log.info("ensayo descartado, rama real intacta");
        }
      } else {
        const mergeStart = performance.now();
        mergeOutcome = await mergeChanges(
          ws,
          mode.runAudit ? "D-Engine: cambios consolidados en modo verify" : "D-Engine: cambios consolidados en modo fast",
          [...new Set(applied.map((result) => result.filePath))]
        );
        timings.mergeMs += performance.now() - mergeStart;
      }
    }

    const created = mergeOutcome.created.length;
    const edited = mergeOutcome.edited.length;
    const attemptTokens = sumTokens(outcome.attempts);
    const runTokens = attemptTokens.total + llmTokens.selector + llmTokens.audit;
    const sessionMs = performance.now() - sessionStart;
    const agentEstimate = resolveAgentTokenEstimate(process.env.D_ENGINE_AGENT_TOKEN_ESTIMATE);
    log.info(pc.dim("Resultado: ") + pc.white(`${created} archivo(s) creado(s)`) + pc.dim(" · ") + pc.white(`${edited} editado(s)`));
    log.info(pc.dim("Tokens del run: ") + pc.white(tokenSummary(attemptTokens.total)));
    log.info(pc.dim(formatLlmCalls(llmCalls)));
    if (mergeOutcome.merged && fuzzyAuditUnavailable > 0) {
      log.warn(
        pc.yellow(
          `${fuzzyAuditUnavailable} parche(s) fuzzy consolidado(s) SIN auditoria (auditoria no disponible)`
        )
      );
    }
    log.info(pc.bold("Tiempos por fase:"));
    for (const line of timingLines(timings, sessionMs)) {
      log.info(pc.dim(`  ${line}`));
    }
    log.info(pc.magenta(costComparisonLine(runTokens, agentEstimate)));
    outro(pc.cyan("D-Engine") + pc.dim(" finalizado."));
  } finally {
    if (shadowCreated) {
      await destroyShadow(s, ws);
      log.info(pc.dim("Fotocopia y rama temporal eliminadas."));
    }
  }

  try {
    const head = await ws.headLog();
    log.info(pc.dim("git log -1: ") + pc.white(head));
  } catch (error) {
    log.warn("No se pudo leer git log -1: " + (error instanceof Error ? error.message : String(error)));
  }

  process.exit(0);
}

main().catch((err) => {
  if (llmTotal(llmCalls) > 0) log.info(pc.dim(formatLlmCalls(llmCalls)));
  cancel(pc.red("Error inesperado: ") + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
