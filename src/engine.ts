import { execa } from "execa";
import os from "node:os";
import path from "node:path";

interface GitOptions {
  cwd?: string;
}

async function runGit(args: string[], action: string, options: GitOptions = {}): Promise<string> {
  try {
    const { stdout } = await execa("git", args, options);
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`git no pudo ${action}: ${stderr || detail}`);
  }
}

export class ShadowWorkspace {
  private branch = "";
  private worktreePath = "";
  private originalBranch = "";

  get path(): string {
    return this.worktreePath;
  }

  get branchName(): string {
    return this.branch;
  }

  get baseBranch(): string {
    return this.originalBranch;
  }

  async create(): Promise<string> {
    const stamp = Date.now();
    this.branch = `shadow-${stamp}`;
    this.worktreePath = path.join(os.tmpdir(), `d-engine-${stamp}`);

    const current = await runGit(["branch", "--show-current"], "detectar la rama actual");
    this.originalBranch = current.trim();

    await runGit(
      ["worktree", "add", "-b", this.branch, this.worktreePath],
      "crear la fotocopia"
    );

    return this.worktreePath;
  }

  async destroy(): Promise<void> {
    await runGit(
      ["worktree", "remove", "--force", this.worktreePath],
      "borrar la fotocopia"
    );
    await runGit(["branch", "-D", this.branch], "borrar la rama temporal");
  }

  async commitAndMerge(message: string): Promise<boolean> {
    const status = await runGit(["status", "--porcelain"], "comprobar cambios pendientes", {
      cwd: this.worktreePath,
    });

    if (status.trim().length === 0) {
      return false;
    }

    await runGit(["add", "-A"], "preparar los cambios", { cwd: this.worktreePath });
    await runGit(["commit", "-m", message], "hacer commit en la fotocopia", {
      cwd: this.worktreePath,
    });
    await runGit(["merge", this.branch], "fusionar en la rama original");
    return true;
  }
}
