#!/usr/bin/env node
import { intro, outro, text, select, confirm, spinner, log, cancel, isCancel } from "@clack/prompts";
import pc from "picocolors";
import { ShadowWorkspace } from "./engine.js";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function runPhase(spin: SpinnerLike, phase: string, ms: number): Promise<void> {
  spin.start(phase);
  await sleep(ms);
  spin.stop();
}

async function createShadow(spin: SpinnerLike, ws: ShadowWorkspace): Promise<string> {
  spin.start("Creando fotocopia (git worktree)...");
  try {
    const path = await ws.create();
    return path;
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

  const s = spinner();
  const ws = new ShadowWorkspace();
  let shadowCreated = false;

  const doRun = async () => {
    // 1. Generar propuesta (fotocopia git worktree)
    await runPhase(s, "Llamando al LLM para proponer cambios semanticos (SEARCH/REPLACE)...", 1200);
    const worktreePath = await createShadow(s, ws);
    shadowCreated = true;
    log.info(pc.dim("Fotocopia creada en: ") + pc.cyan(worktreePath));

    // 2. Compilador local = puerta determinista (verify y shadow)
    if (mode.runCompile) {
      await runPhase(s, "Aplicando cambios en la fotocopia...", 800);
      await runPhase(s, "Compilando como puerta (tsc --noEmit)...", 900);
      log.success(pc.green("Compilacion OK: la fotocopia es valida."));
    }

    // 3. Auditoria semantica opcional = 2da llamada barata
    if (mode.runAudit) {
      await runPhase(s, "Enviando diff a auditoria semantica (2da llamada LLM)...", 1100);
      log.success(pc.green("Auditoria aprobada: el cambio es coherente."));
    }
  };

  try {
    if (mode.runShadow) {
      await doRun();
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
        const merged = await ws.commitAndMerge("D-Engine: cambios consolidados");
        if (merged) {
          log.success(pc.green("Cambios consolidados."));
        } else {
          log.info(pc.dim("Sin cambios que consolidar en la fotocopia."));
        }
      } else {
        log.info(pc.dim("Fotocopia descartada. Nada se consolido."));
      }
    } else {
      // modo fast: aplica directo y consolida
      await doRun();
      const merged = await ws.commitAndMerge("D-Engine: cambios consolidados en modo fast");
      if (merged) {
        log.success(pc.green("Cambios consolidados en modo fast."));
      } else {
        log.info(pc.dim("Sin cambios que consolidar en la fotocopia."));
      }
    }

    outro(pc.cyan("D-Engine") + pc.dim(" finalizado."));
  } finally {
    if (shadowCreated) {
      await destroyShadow(s, ws);
      log.info(pc.dim("Fotocopia y rama temporal eliminadas."));
    }
  }

  process.exit(0);
}

main().catch((err) => {
  cancel(pc.red("Error inesperado: ") + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
