import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, constants, realpath, stat, statfs } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";

import { repositoryStateDirectory } from "./jsonl-journal.js";
import type { CommandResult, PreflightEnvironment } from "../ports/preflight.js";

const execFileAsync = promisify(execFile);
const btrfsMagic = 0x9123683e;

const filesystemName = async (path: string): Promise<string> => {
  const stats = await statfs(path);
  return Number(stats.type) === btrfsMagic ? "btrfs" : `0x${Number(stats.type).toString(16)}`;
};

const nearestExistingDirectory = async (path: string): Promise<string | undefined> => {
  let candidate = path;
  while (true) {
    try {
      const metadata = await stat(candidate);
      if (!metadata.isDirectory()) return undefined;
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) return undefined;
      candidate = parent;
    }
  }
};

const canWriteDirectory = async (path: string): Promise<boolean> => {
  try {
    const existing = await nearestExistingDirectory(path);
    if (existing === undefined) return false;
    await access(existing, constants.W_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const run = async (executable: string, arguments_: readonly string[], cwd: string): Promise<CommandResult> => {
  try {
    const { stdout, stderr } = await execFileAsync(executable, [...arguments_], {
      cwd,
      shell: false,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const commandError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    return {
      exitCode: typeof commandError.code === "number" ? commandError.code : commandError.code === "ENOENT" ? 127 : 1,
      stdout: commandError.stdout ?? "",
      stderr: commandError.stderr ?? commandError.message,
    };
  }
};

/** Node implementation of the fixed, read-only preflight probes. */
export const nodePreflightEnvironment = (): PreflightEnvironment => ({
  platform: process.platform,
  nodeVersion: process.version,
  run,
  filesystemType: filesystemName,
  canWriteDirectory,
  canonicalPath: realpath,
  coordinatorStateDirectory: (repositoryId) => repositoryStateDirectory(homedir(), repositoryId),
});
