#!/usr/bin/env node
import { intro, outro, text, select, confirm, spinner, log, cancel, isCancel } from "@clack/prompts";
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { LLMParser, LocalEditor, ShadowWorkspace, Validator, type EditBlock } from "./engine.js";
import { proposeChanges, proposeCorrection } from "./llm.js";

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
    runShadow: true,
    runCompile: true,
    runAudit: true,
  },
  shadow: {
    label: "Shadow",
    description: "Aplica en fotocopia pero NO consolida",
    llmCalls: 1,
    runShadow: true,
    runCompile: true,
    runAudit: false,
  },
};

const DEMO_REL = path.join("src", "demo", "calculator.ts");

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

function ensureDemoFile(worktreePath: string): void {
  const src = path.join(process.cwd(), DEMO_REL);
  const dest = path.join(worktreePath, DEMO_REL);
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

function normalizeRel(rel: string): string {
  return rel.replaceAll("\\", "/").replace(/^\.\//, "");
}

function withNormalizedPaths(blocks: EditBlock[]): EditBlock[] {
  return blocks.map((block) => ({ ...block, filePath: normalizeRel(block.filePath) }));
}

function missingBlockPaths(worktreePath: string, blocks: EditBlock[]): string[] {
  return blocks
    .map((block) => block.filePath)
    .filter((rel) => !existsSync(path.join(worktreePath, rel)));
}

async function mergeChanges(ws: ShadowWorkspace, message: string): Promise<void> {
  const merged = await ws.commitAndMerge(message);
  if (merged) {
    log.success(pc.green("Cambios consolidados en la rama real."));
  } else {
    log.info(pc.dim("Sin cambios que consolidar en la fotocopia."));
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
    cancel("Operacion cancelada.");
    process.exit(0);
  }

  log.info(pc.dim("Prompt recibido: ") + pc.white(promptText));
  log.info(pc.dim("Modo de seguridad: ") + pc.magenta(mode.label) + pc.dim(`  (${mode.llmCalls} llamada(s) LLM)`));
  const demoPath = DEMO_REL.replaceAll("\\", "/");
  log.info(pc.dim("Archivo objetivo: ") + pc.cyan(demoPath));

  const s = spinner();
  const ws = new ShadowWorkspace();
  let shadowCreated = false;

  try {
    const worktreePath = await createShadow(s, ws);
    shadowCreated = true;
    log.info(pc.dim("Fotocopia creada en: ") + pc.cyan(worktreePath));

    linkNodeModules(worktreePath);
    ensureDemoFile(worktreePath);

    const fileContent = readFileSync(path.join(worktreePath, DEMO_REL), "utf8");

    s.start("Llamando al LLM para proponer SEARCH/REPLACE...");
    let proposal = await proposeChanges(promptText, demoPath, fileContent);
    let blocks;
    try {
      blocks = LLMParser.parse(proposal.text);
    } catch {
      log.warn("La respuesta no tenia bloques validos. Reintentando una vez...");
      proposal = await proposeCorrection(promptText, demoPath, fileContent, proposal.text);
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
    let missing = missingBlockPaths(worktreePath, blocks);
    if (missing.length > 0) {
      const wrong = missing[0] ?? "(desconocida)";
      log.warn(`Ruta de bloque no existe en la fotocopia: ${wrong}. Reintentando una vez...`);
      const pathCorrection =
        `el archivo a modificar es exactamente ${demoPath}; tu bloque apuntaba a ${wrong}; responde solo con bloques corregidos`;
      proposal = await proposeCorrection(promptText, demoPath, fileContent, proposal.text, pathCorrection);
      try {
        blocks = withNormalizedPaths(LLMParser.parse(proposal.text));
      } catch {
        s.stop();
        throw new Error(
          `El LLM no devolvio bloques SEARCH/REPLACE validos al corregir la ruta. Objetivo: ${demoPath}.`
        );
      }
      missing = missingBlockPaths(worktreePath, blocks);
      if (missing.length > 0) {
        s.stop();
        const stillWrong = missing[0] ?? wrong;
        throw new Error(
          `El archivo del bloque no existe en la fotocopia (apuntaba a ${stillWrong}; el objetivo es ${demoPath}) tras 1 reintento.`
        );
      }
    }

    const applied = blocks.map((block) => LocalEditor.apply(worktreePath, block));
    s.stop();
    for (const result of applied) {
      log.success(pc.green(`Parche aplicado en ${result.filePath} (${result.strategy})`));
    }

    s.start("Compilando como puerta (tsc --noEmit)...");
    const check = await Validator.run(worktreePath);
    s.stop();

    if (!check.ok) {
      log.error(pc.red("La puerta de compilacion rechazo el cambio. Nada se consolida."));
      if (check.output.length > 0) {
        log.message(check.output);
      }
    } else {
      log.success(pc.green("Compilacion OK: la fotocopia es valida."));

      if (mode.runAudit) {
        log.info(pc.dim("Auditoria semantica: pendiente de conectar al LLM (sin llamada simulada)."));
      }

      if (mode.runShadow) {
        log.warn(
          pc.yellow("Modo shadow: los cambios solo existen en la fotocopia. " + pc.bold("NO se consolidaron en el disco real."))
        );

        const consolidate = handleCancel(
          await confirm({
            message: "Consolidar los cambios de la fotocopia al disco real?",
            active: "Consolidar",
            inactive: "Descartar (rollback)",
          })
        );

        if (consolidate) {
          await mergeChanges(ws, "D-Engine: cambios consolidados");
        } else {
          log.info(pc.dim("Fotocopia descartada. Nada se consolido."));
        }
      } else {
        await mergeChanges(ws, "D-Engine: cambios consolidados en modo fast");
      }
    }

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
  cancel(pc.red("Error inesperado: ") + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
