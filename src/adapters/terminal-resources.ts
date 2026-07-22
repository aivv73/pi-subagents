import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import type { RetainedAgent, RetainedRift, TerminalResourceRuntime } from "../ports/terminal-resources.js";

const execFileAsync = promisify(execFile);

export class TerminalResourceError extends Error { override readonly name = "TerminalResourceError"; }

const run = async (executable: string, arguments_: readonly string[], cwd: string): Promise<string> => {
  try {
    const { stdout, stderr } = await execFileAsync(executable, [...arguments_], { cwd, shell: false, maxBuffer: 1024 * 1024 });
    return stdout || stderr;
  } catch (error) {
    const detail = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string; code?: number | string };
    throw new TerminalResourceError(`${executable} ${arguments_.join(" ")}: ${detail.stderr ?? detail.stdout ?? detail.message}`);
  }
};

const refExists = async (bare: string, ref: string): Promise<boolean> => {
  try {
    await execFileAsync("git", ["--git-dir", bare, "show-ref", "--verify", "--quiet", `refs/heads/${ref}`], { cwd: bare, shell: false });
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return false;
    throw error;
  }
};

/** Fixed-argv lifecycle adapter; it can never unregister the coordinator source Rift root. */
export class NodeTerminalResourceRuntime implements TerminalResourceRuntime {
  constructor(private readonly options: { readonly herdrExecutable?: string; readonly riftExecutable?: string; readonly gitExecutable?: string } = {}) {}

  requestCooperativeStop(agent: RetainedAgent): Promise<void> {
    return run(this.options.herdrExecutable ?? "herdr", ["agent", "send", agent.name, "Please stop now; the coordinator is cancelling this run."], process.cwd()).then(() => undefined);
  }

  async waitForStop(agent: RetainedAgent, timeoutMs: number): Promise<boolean> {
    try {
      await run(this.options.herdrExecutable ?? "herdr", ["agent", "wait", agent.name, "--status", "idle", "--timeout", String(timeoutMs)], process.cwd());
      return true;
    } catch {
      return false;
    }
  }

  sendInterrupt(agent: RetainedAgent): Promise<void> {
    return run(this.options.herdrExecutable ?? "herdr", ["pane", "send-keys", agent.paneId, "C-c"], process.cwd()).then(() => undefined);
  }

  async deleteTransportRef(stateDirectory: string, ref: string, expectedCommitId: string): Promise<void> {
    const bare = resolve(stateDirectory, "transport.git");
    if (!(await refExists(bare, ref))) return;
    await run(this.options.gitExecutable ?? "git", ["--git-dir", bare, "update-ref", "-d", `refs/heads/${ref}`, expectedCommitId], bare);
    if (await refExists(bare, ref)) throw new TerminalResourceError("transport ref remains after lease deletion");
  }

  closePane(agent: RetainedAgent): Promise<void> {
    return run(this.options.herdrExecutable ?? "herdr", ["pane", "close", agent.paneId], process.cwd()).then(() => undefined);
  }

  async removeRift(rift: RetainedRift, sourceRoot: string): Promise<void> {
    const source = await realpath(sourceRoot);
    const target = resolve(rift.root);
    if (target === source) throw new TerminalResourceError("refusing to unregister or remove the source Rift root");
    try {
      const metadata = await lstat(target);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new TerminalResourceError("Rift target is not a real directory");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await run(this.options.riftExecutable ?? "rift", ["remove", target], source);
  }

  garbageCollectRifts(): Promise<void> {
    return run(this.options.riftExecutable ?? "rift", ["gc"], process.cwd()).then(() => undefined);
  }
}
