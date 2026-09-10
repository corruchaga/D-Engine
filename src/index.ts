#!/usr/bin/env node
import { intro, outro, text, select, confirm, spinner, log, cancel, isCancel } from "@clack/prompts";
import { copyFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { LLMParser, LocalEditor, PorcelainGuardError, ShadowWorkspace, Validator, type EditBlock } from "./engine.js";
import { buildSelectorCatalog } from "./context.js";
import { parseVerifyVerdict, proposeChanges, proposeCorrection, selectTargetFiles, verifyChanges } from "./llm.js";
import { normalizeRel, resolveSelectorPaths } from "./selector.js";

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

const llmCalls = { selector: 0, proposal: 0, audit: 0 };

function llmTotal(): number {
  return llmCalls.selector + llmCalls.proposal + llmCalls.audit;
}

function llmSummary(): string {
  const parts: string[] = [];
  if (llmCalls.selector > 0) parts.push(`selector ${llmCalls.selector}`);
  if (llmCalls.proposal > 0) parts.push(`propuesta ${llmCalls.proposal}`);
  if (llmCalls.audit > 0) parts.push(`auditoria ${llmCalls.audit}`);
  const detail = parts.length > 0 ? ` (${parts.join(" + ")})` : "";
  return `Llamadas LLM: ${llmTotal()}${detail}`;
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

function withNormalizedPaths(blocks: EditBlock[]): EditBlock[] {
  return blocks.map((block) => ({ ...block, filePath: normalizeRel(block.filePath) }));
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
  const missing = rels.filter((rel) => !existsSync(path.resolve(process.cwd(), rel)));
  if (missing.length > 0) return `El archivo no existe en el repo: ${missing.join(", ")}`;
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
  spin.start("Seleccionando archivos objetivo...");
  let catalog: { text: string; candidates: string[] };
  try {
    catalog = await buildSelectorCatalog(promptText);
  } catch {
    spin.stop();
    log.warn("No se pudo construir el catalogo. Elige archivos a mano.");
    return askManualTargets();
  }
  if (catalog.candidates.length === 0) {
    spin.stop();
    log.warn("No hay archivos candidatos. Elige archivos a mano.");
    return askManualTargets();
  }

  try {
    let result = await selectTargetFiles(promptText, catalog.text);
    llmCalls.selector += 1;
    let resolved = resolveSelectorPaths(result.text, catalog.candidates);
    if (!resolved.ok) {
      log.warn(`Selector: ${resolved.reason}. Reintentando una vez...`);
      const feedback =
        resolved.reason === "formato invalido"
          ? "formato invalido; responde solo un JSON array de rutas del catalogo"
          : `${resolved.reason}; responde solo un JSON array de rutas del catalogo`;
      result = await selectTargetFiles(promptText, catalog.text, {
        previousText: result.text,
        feedback,
      });
      llmCalls.selector += 1;
      resolved = resolveSelectorPaths(result.text, catalog.candidates);
    }
    spin.stop();
    if (!resolved.ok) {
      log.warn("El selector no devolvio rutas validas. Elige archivos a mano.");
      return askManualTargets();
    }
    log.info(pc.dim("Seleccion automatica: ") + pc.cyan(resolved.paths.join(", ")));
    const choice = handleCancel(
      await select({
        message: "¿Usar estos archivos?",
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
    log.warn("El selector fallo. Elige archivos a mano.");
    return askManualTargets();
  }
}

function unauthorizedBlockPaths(blocks: EditBlock[], targets: string[]): string[] {
  const allowed = new Set(targets);
  return [...new Set(blocks.map((block) => block.filePath).filter((rel) => !allowed.has(rel)))];
}

async function mergeChanges(ws: ShadowWorkspace, message: string, files: string[]): Promise<void> {
  try {
    const merged = await ws.commitAndMerge(message, files);
    if (merged) {
      log.success(pc.green("Cambios consolidados en la rama real."));
    } else {
      log.info(pc.dim("Sin cambios que consolidar en la fotocopia."));
    }
  } catch (error) {
    if (error instanceof PorcelainGuardError) {
      log.error(
        pc.red(
          `La puerta rechazo el cambio: se detectaron modificaciones fuera de los archivos del parche: ${error.files.join(", ")}. Nada se consolida.`
        )
      );
      return;
    }
    throw error;
  }
}

async function main(): Promise<void> {
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
    if (llmTotal() > 0) log.info(pc.dim(llmSummary()));
    cancel("Operacion cancelada.");
    process.exit(0);
  }

  log.info(pc.dim("Prompt recibido: ") + pc.white(promptText));
  log.info(pc.dim("Modo de seguridad: ") + pc.magenta(mode.label) + pc.dim(`  (${mode.llmCalls} llamada(s) LLM)`));
  log.info(pc.dim("Archivos objetivo: ") + pc.cyan(targetRels.join(", ")));

  const s = spinner();
  const ws = new ShadowWorkspace();
  let shadowCreated = false;

  try {
    const worktreePath = await createShadow(s, ws);
    shadowCreated = true;
    log.info(pc.dim("Fotocopia creada en: ") + pc.cyan(worktreePath));

    linkNodeModules(worktreePath);

    s.start("Llamando al LLM para proponer SEARCH/REPLACE...");
    let proposal = await proposeChanges(promptText, targetRels);
    llmCalls.proposal += 1;
    let blocks;
    try {
      blocks = LLMParser.parse(proposal.text);
    } catch {
      log.warn("La respuesta no tenia bloques validos. Reintentando una vez...");
      proposal = await proposeCorrection(promptText, targetRels, proposal.text);
      llmCalls.proposal += 1;
      try {
        blocks = LLMParser.parse(proposal.text);
      } catch {
        s.stop();
        throw new Error(
          "El LLM no devolvio bloques SEARCH/REPLACE validos tras 2 intentos. Revisa el modelo o el prompt."
        );
      }
    }
    blocks = withNormalizedPaths(blocks);
    let missing = unauthorizedBlockPaths(blocks, targetRels);
    if (missing.length > 0) {
      const wrong = missing[0] ?? "(desconocida)";
      const allowed = targetRels.join(", ");
      log.warn(`Ruta de bloque no es un archivo objetivo: ${wrong}. Reintentando una vez...`);
      const pathCorrection =
        `los archivos a modificar son exactamente ${allowed}; tu bloque apuntaba a ${wrong}; responde solo con bloques corregidos`;
      proposal = await proposeCorrection(promptText, targetRels, proposal.text, pathCorrection);
      llmCalls.proposal += 1;
      try {
        blocks = withNormalizedPaths(LLMParser.parse(proposal.text));
      } catch {
        s.stop();
        throw new Error(
          `El LLM no devolvio bloques SEARCH/REPLACE validos al corregir la ruta. Objetivos: ${allowed}.`
        );
      }
      missing = unauthorizedBlockPaths(blocks, targetRels);
      if (missing.length > 0) {
        s.stop();
        const stillWrong = missing[0] ?? wrong;
        throw new Error(
          `El archivo del bloque no es un objetivo (apuntaba a ${stillWrong}; los objetivos son ${allowed}) tras 1 reintento.`
        );
      }
    }

    for (const block of blocks) ensureDemoFile(worktreePath, block.filePath);
    let applied = blocks.map((block) => LocalEditor.apply(worktreePath, block));
    s.stop();
    for (const result of applied) {
      log.success(pc.green(`Parche aplicado en ${result.filePath} (${result.strategy})`));
    }

    s.start("Compilando como puerta (tsc --noEmit)...");
    let check = await Validator.run(worktreePath);
    s.stop();

    if (!check.ok) {
      console.log("[d-engine] compilacion fallida, reintentando con feedback (1/1)");
      log.warn("Compilacion fallida. Reintentando con feedback (1/1)...");
      if (check.output.length > 0) {
        log.message(check.output);
      }
      await ws.restoreFiles(applied.map((result) => result.filePath));
      const compileFeedback = [
        "la compilacion (tsc --noEmit) fallo. Regenera UNICAMENTE bloques SEARCH/REPLACE que corrijan estos errores.",
        "El archivo objetivo esta en su estado original; no asumas que el intento anterior sigue aplicado.",
        "Errores de tsc:",
        check.output || "(sin output)",
      ].join("\n");
      s.start("Llamando al LLM para corregir errores de compilacion...");
      proposal = await proposeCorrection(promptText, targetRels, proposal.text, compileFeedback);
      llmCalls.proposal += 1;
      try {
        blocks = withNormalizedPaths(LLMParser.parse(proposal.text));
      } catch {
        s.stop();
        throw new Error(
          "El LLM no devolvio bloques SEARCH/REPLACE validos al corregir la compilacion."
        );
      }
      missing = unauthorizedBlockPaths(blocks, targetRels);
      if (missing.length > 0) {
        s.stop();
        const stillWrong = missing[0] ?? "(desconocida)";
        throw new Error(
          `El archivo del bloque no es un objetivo (apuntaba a ${stillWrong}; los objetivos son ${targetRels.join(", ")}) al corregir la compilacion.`
        );
      }
      for (const block of blocks) ensureDemoFile(worktreePath, block.filePath);
      applied = blocks.map((block) => LocalEditor.apply(worktreePath, block));
      s.stop();
      for (const result of applied) {
        log.success(pc.green(`Parche aplicado en ${result.filePath} (${result.strategy})`));
      }
      s.start("Compilando como puerta (tsc --noEmit)...");
      check = await Validator.run(worktreePath);
      s.stop();
    }

    if (!check.ok) {
      log.error(pc.red("La puerta de compilacion rechazo el cambio. Nada se consolida."));
      if (check.output.length > 0) {
        log.message(check.output);
      }
    } else {
      log.success(pc.green("Compilacion OK: la fotocopia es valida."));

      let auditOk = true;
      if (mode.runAudit) {
        s.start("Auditoria semantica (2da llamada LLM)...");
        const diff = await ws.diffHead();
        const audit = await verifyChanges(promptText, diff);
        llmCalls.audit += 1;
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
        const diff = await ws.diffHead();
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
          await mergeChanges(ws, "D-Engine: cambios consolidados en modo shadow", [
            ...new Set(applied.map((result) => result.filePath)),
          ]);
        } else {
          await destroyShadow(s, ws);
          shadowCreated = false;
          log.info("ensayo descartado, rama real intacta");
        }
      } else {
        await mergeChanges(
          ws,
          mode.runAudit ? "D-Engine: cambios consolidados en modo verify" : "D-Engine: cambios consolidados en modo fast",
          [...new Set(applied.map((result) => result.filePath))]
        );
      }
    }

    log.info(pc.dim(llmSummary()));
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
  if (llmTotal() > 0) log.info(pc.dim(llmSummary()));
  cancel(pc.red("Error inesperado: ") + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
