import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdtemp, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  ArtifactError,
  createAttemptArtifacts,
  ensureArtifactIgnore,
  preserveCurrentCommit,
  readAttemptEnvelope,
  readResultArtifact,
  writeResultAtomically,
} from "./artifacts.js";

const execFile = promisify(execFileCallback);

const withRepository = async (test: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "pi-subagents-artifacts-"));
  try {
    await execFile("jj", ["git", "init", "--colocate", root]);
    await test(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const envelope = (root: string) => ({
  schemaVersion: 1,
  runId: "run-1",
  taskId: "task-1",
  attemptId: "attempt-1",
  role: "worker" as const,
  task: "Update README",
  root,
  allowedTrackedPaths: ["README.md"],
  assignedBaseCommitId: "base-commit",
  outputRelativePath: "output/worker-result.v1.json",
});

describe("attempt artifact adapter", () => {
  it("ignores coordinator artifacts and proves their creation preserves the Jujutsu commit", async () => {
    await withRepository(async (root) => {
      await ensureArtifactIgnore(root);
      const artifacts = await preserveCurrentCommit(root, () => createAttemptArtifacts(root, envelope(root)));
      const stored = await readAttemptEnvelope(artifacts);

      expect(stored).toMatchObject({ runId: "run-1", role: "worker", root });
      expect(await readFile(artifacts.checksumPath, "utf8")).toMatch(/^[a-f0-9]{64}\n$/);
      expect((await lstat(artifacts.inputPath)).mode & 0o077).toBe(0);
      await expect(execFile("git", ["check-ignore", "-q", "--", ".pi-subagents/runs/run-1"] , { cwd: root })).resolves.toBeDefined();
      await chmod(artifacts.inputPath, 0o600);
      await writeFile(artifacts.inputPath, "{}\n");
      await chmod(artifacts.inputPath, 0o400);
      await expect(readAttemptEnvelope(artifacts)).rejects.toBeInstanceOf(ArtifactError);
    });
  });

  it("accepts only strict, bound, atomic, bounded regular result files", async () => {
    await withRepository(async (root) => {
      await ensureArtifactIgnore(root);
      const artifacts = await createAttemptArtifacts(root, envelope(root));
      const result = JSON.stringify({
        _tag: "worker",
        schemaVersion: 1,
        runId: "run-1",
        taskId: "task-1",
        attemptId: "attempt-1",
        changeId: "change-1",
        commitId: "commit-1",
        changedPaths: ["README.md"],
      });
      await preserveCurrentCommit(root, () => writeResultAtomically(artifacts, result));
      expect(await readResultArtifact(artifacts)).toMatchObject({ _tag: "worker", commitId: "commit-1" });

      await expect(writeResultAtomically(artifacts, JSON.stringify({ ...JSON.parse(result), extra: true }))).rejects.toBeInstanceOf(ArtifactError);
      await expect(writeResultAtomically(artifacts, JSON.stringify({ ...JSON.parse(result), runId: "other" }))).rejects.toBeInstanceOf(ArtifactError);
      await expect(writeResultAtomically(artifacts, "x".repeat(1024), 32)).rejects.toBeInstanceOf(ArtifactError);

      await rm(artifacts.outputPath);
      await symlink("/etc/hosts", artifacts.outputPath);
      await expect(readResultArtifact(artifacts)).rejects.toBeInstanceOf(ArtifactError);
    });
  });
});
