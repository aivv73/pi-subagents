import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { RevisionIdentity, WorkerRevisionFacts } from "../domain/worker-attempt.js";
import type { IntegrationRuntime, SourceIntegrationFacts } from "../ports/integration.js";

const execFileAsync = promisify(execFile);

export class IntegrationRuntimeError extends Error {
  override readonly name = "IntegrationRuntimeError";
}

const run = async (arguments_: readonly string[], cwd: string): Promise<string> => {
  try {
    const { stdout, stderr } = await execFileAsync("jj", [...arguments_], { cwd, shell: false, maxBuffer: 1024 * 1024 });
    return stdout || stderr;
  } catch (error) {
    const detail = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    throw new IntegrationRuntimeError(`jj ${arguments_.join(" ")}: ${detail.stderr ?? detail.stdout ?? detail.message}`);
  }
};

const identity = (output: string, message: string): RevisionIdentity => {
  const [commitId, changeId, ...rest] = output.trim().split("\t");
  if (commitId === undefined || changeId === undefined || commitId === "" || changeId === "" || rest.length !== 0) throw new IntegrationRuntimeError(message);
  return { commitId, changeId };
};

const lines = (output: string): readonly string[] => output.trim() === "" ? [] : output.trim().split("\n");

/** Coordinator-only Jujutsu integration adapter. It never reads worker files or invokes merge/rebase. */
export class NodeIntegrationRuntime implements IntegrationRuntime {
  async inspectSource(root: string): Promise<SourceIntegrationFacts> {
    const current = identity(await run(["log", "--no-graph", "-r", "@", "-T", 'commit_id ++ "\\t" ++ change_id'], root), "source @ did not resolve exactly");
    const [parents, changedPaths, conflict, operationId] = await Promise.all([
      run(["log", "--no-graph", "-r", "@", "-T", 'parents.map(|p| p.commit_id()).join(",")'], root),
      run(["diff", "--name-only", "-r", "@"], root),
      run(["log", "--no-graph", "-r", "@", "-T", "conflict"], root),
      run(["op", "log", "--no-graph", "--limit", "1", "-T", "id"], root),
    ]);
    const operation = operationId.trim();
    if (operation === "" || operation.includes("\n")) throw new IntegrationRuntimeError("source operation did not resolve exactly");
    return {
      ...current,
      parentCommitIds: parents.trim() === "" ? [] : parents.trim().split(","),
      changedPaths: lines(changedPaths),
      isConflicted: conflict.trim() !== "false",
      operationId: operation,
    };
  }

  async inspectRevision(root: string, revision: string, assignedBaseCommitId: string): Promise<WorkerRevisionFacts> {
    const current = identity(await run(["log", "--no-graph", "-r", revision, "-T", 'commit_id ++ "\\t" ++ change_id'], root), "approved revision did not resolve exactly");
    const [parents, revisionCommits, descendant, description, changedPaths, trackedPaths, conflict] = await Promise.all([
      run(["log", "--no-graph", "-r", revision, "-T", 'parents.map(|p| p.commit_id()).join(",")'], root),
      run(["log", "--no-graph", "-r", `${revision} & descendants(${assignedBaseCommitId})`, "-T", "commit_id"], root),
      run(["log", "--no-graph", "-r", `${revision} & descendants(${assignedBaseCommitId})`, "-T", "commit_id"], root),
      run(["log", "--no-graph", "-r", revision, "-T", "description"], root),
      run(["diff", "--name-only", "-r", revision], root),
      run(["file", "list", "-r", revision], root),
      run(["log", "--no-graph", "-r", revision, "-T", "conflict"], root),
    ]);
    return {
      ...current, assignedBaseCommitId,
      parentCommitIds: parents.trim() === "" ? [] : parents.trim().split(","), revisionCommitIds: lines(revisionCommits),
      isDescendantOfAssignedBase: descendant.trim() === current.commitId, isConflicted: conflict.trim() !== "false", description,
      changedPaths: lines(changedPaths), trackedArtifactPaths: lines(trackedPaths).filter((path) => path === ".pi-subagents" || path.startsWith(".pi-subagents/")),
    };
  }

  resolveTransportRef(root: string, transportRef: string): Promise<RevisionIdentity> {
    return run(["log", "--no-graph", "-r", `${transportRef}@pi-subagents-transport`, "-T", 'commit_id ++ "\\t" ++ change_id'], root).then((value) => identity(value, "transport ref did not resolve exactly"));
  }

  createEmptyWorkingCopy(root: string, approvedCommitId: string): Promise<void> {
    return run(["new", approvedCommitId], root).then(() => undefined);
  }
}
