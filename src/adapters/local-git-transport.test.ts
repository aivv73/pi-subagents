import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { attemptTransportRef } from "../domain/git-transport.js";
import { LocalGitTransport, LocalGitTransportError } from "./local-git-transport.js";

const execFile = promisify(execFileCallback);

const jj = async (root: string, arguments_: readonly string[]): Promise<string> =>
  (await execFile("jj", arguments_, { cwd: root })).stdout;

const identity = async (root: string): Promise<{ commitId: string; changeId: string }> => {
  const [commitId, changeId] = (await jj(root, ["log", "--no-graph", "-r", "@", "-T", 'commit_id ++ "\\t" ++ change_id'])).trim().split("\t");
  if (commitId === undefined || changeId === undefined) throw new Error("missing Jujutsu identity");
  return { commitId, changeId };
};

const withRepositories = async (test: (fixture: {
  readonly root: string;
  readonly source: string;
  readonly worker: string;
  readonly baseCommitId: string;
  readonly revision: { readonly commitId: string; readonly changeId: string };
}) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "pi-subagents-transport-"));
  const source = join(root, "source");
  const worker = join(root, "worker");
  try {
    await execFile("jj", ["git", "init", "--colocate", source]);
    await writeFile(join(source, "README.md"), "base\n");
    await jj(source, ["describe", "-m", "base"]);
    await jj(source, ["new"]);
    const baseCommitId = (await jj(source, ["log", "--no-graph", "-r", "@-", "-T", "commit_id"])).trim();
    await cp(source, worker, { recursive: true });
    await jj(worker, ["new", baseCommitId]);
    await writeFile(join(worker, "README.md"), "worker update\n");
    await jj(worker, ["describe", "-m", "worker task"]);
    await test({ root, source, worker, baseCommitId, revision: await identity(worker) });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("LocalGitTransport", () => {
  it("uses one coordinator-local bare ref and fetches the exact worker commit/change without touching source @", async () => {
    await withRepositories(async ({ root, source, worker, baseCommitId, revision }) => {
      const transportRef = attemptTransportRef({ runId: "run-1", taskId: "task-1", attemptId: "attempt-1" });
      const sourceBefore = await identity(source);
      const published = await new LocalGitTransport().publishAndFetch({
        stateDirectory: join(root, "state"),
        coordinatorRoot: source,
        revision: { workerRoot: worker, assignedBaseCommitId: baseCommitId, ...revision, transportRef },
      });
      const bare = join(root, "state", "transport.git");

      expect(published).toEqual({
        transportRef,
        remoteCommitId: revision.commitId,
        fetchedCommitId: revision.commitId,
        fetchedChangeId: revision.changeId,
      });
      expect((await execFile("git", ["--git-dir", bare, "rev-parse", `refs/heads/${transportRef}`])).stdout.trim()).toBe(revision.commitId);
      expect(await identity(source)).toEqual(sourceBefore);
      expect(await jj(source, ["git", "remote", "list"])).toContain(`pi-subagents-transport ${bare}`);
      expect(await jj(worker, ["git", "remote", "list"])).toContain(`pi-subagents-transport ${bare}`);
      expect((await execFile("git", ["--git-dir", bare, "config", "--get", "core.hooksPath"])).stdout.trim()).toBe("/dev/null");
      expect(await readFile(join(bare, "HEAD"), "utf8")).toContain("ref:");
    });
  });

  it("fails closed rather than overwriting an existing attempt ref", async () => {
    await withRepositories(async ({ root, source, worker, baseCommitId, revision }) => {
      const transport = new LocalGitTransport();
      const transportRef = attemptTransportRef({ runId: "run-1", taskId: "task-1", attemptId: "attempt-1" });
      const request = {
        stateDirectory: join(root, "state"),
        coordinatorRoot: source,
        revision: { workerRoot: worker, assignedBaseCommitId: baseCommitId, ...revision, transportRef },
      };
      await transport.publishAndFetch(request);
      const bare = join(root, "state", "transport.git");
      const originalTarget = (await execFile("git", ["--git-dir", bare, "rev-parse", `refs/heads/${transportRef}`])).stdout.trim();

      const secondWorker = join(root, "worker-two");
      await cp(source, secondWorker, { recursive: true });
      await jj(secondWorker, ["new", baseCommitId]);
      await writeFile(join(secondWorker, "README.md"), "a different worker update\n");
      await jj(secondWorker, ["describe", "-m", "different task"]);
      const secondRevision = await identity(secondWorker);
      await expect(transport.publishAndFetch({
        ...request,
        revision: { workerRoot: secondWorker, assignedBaseCommitId: baseCommitId, ...secondRevision, transportRef },
      })).rejects.toBeInstanceOf(LocalGitTransportError);
      expect((await execFile("git", ["--git-dir", bare, "rev-parse", `refs/heads/${transportRef}`])).stdout.trim()).toBe(originalTarget);
    });
  });
});
