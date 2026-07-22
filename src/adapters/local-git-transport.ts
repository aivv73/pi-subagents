import { execFile } from "node:child_process";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

import { assertExactWorkerRevision } from "../domain/git-transport.js";
import type { FetchedTransportRevision, GitTransport, TransportPublicationRequest } from "../ports/git-transport.js";

const execFileAsync = promisify(execFile);
const transportRemote = "pi-subagents-transport";

export class LocalGitTransportError extends Error {
  override readonly name = "LocalGitTransportError";
}

const run = async (executable: string, arguments_: readonly string[], cwd: string): Promise<string> => {
  try {
    const { stdout, stderr } = await execFileAsync(executable, [...arguments_], {
      cwd,
      shell: false,
      maxBuffer: 1024 * 1024,
    });
    return stdout || stderr;
  } catch (error) {
    const detail = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    throw new LocalGitTransportError(`${executable} ${arguments_.join(" ")}: ${detail.stderr ?? detail.stdout ?? detail.message}`);
  }
};

const oneLine = (value: string, message: string): string => {
  const lines = value.trim().split("\n").filter(Boolean);
  if (lines.length !== 1 || lines[0] === undefined) throw new LocalGitTransportError(message);
  return lines[0];
};

const parseCommitAndChange = (output: string, message: string): { readonly commitId: string; readonly changeId: string } => {
  const [commitId, changeId, ...rest] = oneLine(output, message).split("\t");
  if (commitId === "" || changeId === "" || commitId === undefined || changeId === undefined || rest.length !== 0) {
    throw new LocalGitTransportError(message);
  }
  return { commitId, changeId };
};

const localRemotePath = async (root: string, remote: string): Promise<string | undefined> => {
  const output = await run("jj", ["git", "remote", "list"], root);
  const line = output.split("\n").find((candidate) => candidate.startsWith(`${remote} `));
  if (line === undefined) return undefined;
  const path = line.slice(remote.length).trim();
  if (path === "" || !isAbsolute(path)) throw new LocalGitTransportError("transport remote is not an absolute local path");
  return realpath(path);
};

const ensureNamedRemote = async (root: string, barePath: string): Promise<void> => {
  const existing = await localRemotePath(root, transportRemote);
  if (existing === undefined) {
    await run("jj", ["git", "remote", "add", transportRemote, barePath], root);
    return;
  }
  if (existing !== barePath) throw new LocalGitTransportError("existing transport remote does not name this coordinator transport");
};

const remoteCommit = async (barePath: string, ref: string): Promise<string | undefined> => {
  try {
    await execFileAsync("git", ["--git-dir", barePath, "show-ref", "--verify", "--quiet", `refs/heads/${ref}`], {
      cwd: barePath,
      shell: false,
    });
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return undefined;
    const detail = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    throw new LocalGitTransportError(`could not inspect transport ref: ${detail.stderr ?? detail.stdout ?? detail.message}`);
  }
  return oneLine(
    await run("git", ["--git-dir", barePath, "rev-parse", "--verify", `refs/heads/${ref}`], barePath),
    "transport ref did not resolve exactly",
  );
};

/**
 * Fixed-argv, coordinator-only local transport. No worker receives this capability,
 * a remote-management tool, upstream remote name, or credential-bearing environment.
 */
export class LocalGitTransport implements GitTransport {
  async publishAndFetch(request: TransportPublicationRequest): Promise<FetchedTransportRevision> {
    assertExactWorkerRevision(request.revision);
    const barePath = await this.ensureBareTransport(request.stateDirectory);
    await Promise.all([
      ensureNamedRemote(request.revision.workerRoot, barePath),
      ensureNamedRemote(request.coordinatorRoot, barePath),
    ]);

    // Fetch establishes Jujutsu's remote bookmark observation used by its force-with-lease push checks.
    await run("jj", ["git", "fetch", "--remote", transportRemote, "--branch", request.revision.transportRef], request.revision.workerRoot);
    const observedRemoteCommitId = await remoteCommit(barePath, request.revision.transportRef);
    if (request.previousCommitId === undefined && observedRemoteCommitId !== undefined) {
      throw new LocalGitTransportError("attempt transport ref already exists; refusing to overwrite it");
    }
    if (request.previousCommitId !== undefined && observedRemoteCommitId !== request.previousCommitId) {
      throw new LocalGitTransportError("attempt transport ref does not match the revision publication lease");
    }
    await run(
      "jj",
      request.previousCommitId === undefined
        ? ["bookmark", "create", request.revision.transportRef, "--revision", request.revision.commitId]
        : ["bookmark", "set", request.revision.transportRef, "--revision", request.revision.commitId],
      request.revision.workerRoot,
    );
    await run("jj", ["git", "push", "--remote", transportRemote, "--bookmark", request.revision.transportRef], request.revision.workerRoot);

    const pushedCommitId = await remoteCommit(barePath, request.revision.transportRef);
    if (pushedCommitId !== request.revision.commitId) {
      throw new LocalGitTransportError("transport ref target differs from the validated worker commit");
    }

    await run("jj", ["git", "fetch", "--remote", transportRemote, "--branch", request.revision.transportRef], request.coordinatorRoot);
    const fetched = parseCommitAndChange(
      await run("jj", ["log", "--no-graph", "-r", `${request.revision.transportRef}@${transportRemote}`, "-T", 'commit_id ++ "\\t" ++ change_id'], request.coordinatorRoot),
      "coordinator fetch did not resolve one exact transport revision",
    );
    if (fetched.commitId !== request.revision.commitId) {
      throw new LocalGitTransportError("fetched transport commit differs from the validated worker commit");
    }
    if (fetched.changeId !== request.revision.changeId) {
      throw new LocalGitTransportError("fetched transport change differs from the validated worker change");
    }
    const ancestry = oneLine(
      await run("jj", ["log", "--no-graph", "-r", `${request.revision.commitId} & descendants(${request.revision.assignedBaseCommitId})`, "-T", "commit_id"], request.coordinatorRoot),
      "fetched transport revision has ambiguous assigned-base ancestry",
    );
    if (ancestry !== request.revision.commitId) {
      throw new LocalGitTransportError("fetched transport revision is not descended from its assigned base");
    }
    const currentRemoteCommitId = await remoteCommit(barePath, request.revision.transportRef);
    if (currentRemoteCommitId !== request.revision.commitId) {
      throw new LocalGitTransportError("transport ref moved while the coordinator fetched it");
    }
    return {
      transportRef: request.revision.transportRef,
      remoteCommitId: currentRemoteCommitId,
      fetchedCommitId: fetched.commitId,
      fetchedChangeId: fetched.changeId,
    };
  }

  private async ensureBareTransport(stateDirectory: string): Promise<string> {
    if (!isAbsolute(stateDirectory)) throw new LocalGitTransportError("coordinator state directory must be absolute");
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    const stateRoot = await realpath(stateDirectory);
    const barePath = join(stateRoot, "transport.git");
    try {
      const metadata = await lstat(barePath);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new LocalGitTransportError("transport path is not a real directory");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await run("git", ["init", "--bare", "--template=/dev/null", barePath], stateRoot);
    }
    const canonicalBarePath = await realpath(barePath);
    if (!canonicalBarePath.startsWith(`${stateRoot}/`)) throw new LocalGitTransportError("transport path escaped coordinator state");
    if ((await run("git", ["--git-dir", canonicalBarePath, "rev-parse", "--is-bare-repository"], stateRoot)).trim() !== "true") {
      throw new LocalGitTransportError("coordinator transport is not a bare Git repository");
    }
    // A reused coordinator state directory must not reactivate hooks from an earlier or tampered transport.
    await run("git", ["--git-dir", canonicalBarePath, "config", "core.hooksPath", "/dev/null"], stateRoot);
    return canonicalBarePath;
  }
}
