import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { GuardDeniedError, GuardedFilesystem } from "./guarded-filesystem.js";

const execFile = promisify(execFileCallback);

const withRoot = async (test: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "pi-subagents-guard-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "allowed.txt"), "before\nneedle\n");
    await writeFile(join(root, ".env"), "SECRET=value\n");
    await mkdir(join(root, ".git"));
    await writeFile(join(root, ".git", "config"), "credential\n");
    await test(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const config = (root: string, role: "worker" | "reviewer") => ({
  schemaVersion: 1,
  role,
  root,
  allowedTrackedPaths: ["src/allowed.txt"],
  resultPath: join(root, ".pi-subagents", "runs", "run-1", "tasks", "task-1", "attempts", "attempt-1", "output", `${role}-result.v1.json`),
  envelope: {
    schemaVersion: 1,
    runId: "run-1",
    taskId: "task-1",
    attemptId: "attempt-1",
    role,
    task: "task",
    root,
    allowedTrackedPaths: ["src/allowed.txt"],
    assignedBaseCommitId: "base",
    outputRelativePath: `output/${role}-result.v1.json`,
  },
  reviewedCommitId: role === "reviewer" ? "reviewed-commit" : undefined,
  reviewedBaseCommitId: role === "reviewer" ? "base" : undefined,
  maxReadBytes: 4096,
  maxOutputBytes: 4096,
});

describe("guarded child filesystem", () => {
  it("contains reads/searches and denies traversal, metadata, environment files, and symlink escape", async () => {
    await withRoot(async (root) => {
      await symlink("/etc/hosts", join(root, "src", "escape"));
      const guard = await GuardedFilesystem.create(config(root, "worker"));
      expect(await guard.read("src/allowed.txt")).toContain("needle");
      expect(await guard.search("needle")).toEqual([expect.objectContaining({ path: "src/allowed.txt" })]);
      await expect(guard.read("../etc/passwd")).rejects.toBeInstanceOf(GuardDeniedError);
      await expect(guard.read(".git/config")).rejects.toBeInstanceOf(GuardDeniedError);
      await expect(guard.read(".env")).rejects.toBeInstanceOf(GuardDeniedError);
      await expect(guard.read("src/escape")).rejects.toBeInstanceOf(GuardDeniedError);
    });
  });

  it("permits only worker writes in exact declared scope and prohibits reviewer mutation", async () => {
    await withRoot(async (root) => {
      const worker = await GuardedFilesystem.create(config(root, "worker"));
      await worker.edit("src/allowed.txt", "before", "after");
      expect(await worker.read("src/allowed.txt")).toContain("after");
      await expect(worker.write("README.md", "nope")).rejects.toBeInstanceOf(GuardDeniedError);

      const reviewer = await GuardedFilesystem.create(config(root, "reviewer"));
      await expect(reviewer.write("src/allowed.txt", "nope")).rejects.toBeInstanceOf(GuardDeniedError);
      await expect(reviewer.jjDescribe("nope")).rejects.toBeInstanceOf(GuardDeniedError);
    });
  });

  it("gives a reviewer only the coordinator-fixed base-to-reviewed revision diff", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-subagents-review-diff-"));
    try {
      await execFile("jj", ["git", "init", "--colocate", root]);
      await writeFile(join(root, "README.md"), "base\n");
      await execFile("jj", ["describe", "-m", "base"], { cwd: root });
      const base = (await execFile("jj", ["log", "--no-graph", "-r", "@", "-T", "commit_id"], { cwd: root })).stdout.trim();
      await execFile("jj", ["new", base], { cwd: root });
      await writeFile(join(root, "README.md"), "reviewed\n");
      await execFile("jj", ["describe", "-m", "review target"], { cwd: root });
      const reviewed = (await execFile("jj", ["log", "--no-graph", "-r", "@", "-T", "commit_id"], { cwd: root })).stdout.trim();
      const reviewer = await GuardedFilesystem.create({ ...config(root, "reviewer"), reviewedCommitId: reviewed, reviewedBaseCommitId: base });

      await expect(reviewer.jjDiff()).resolves.toContain("reviewed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
