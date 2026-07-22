import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { NodeIntegrationRuntime } from "./integration-runtime.js";

const execFile = promisify(execFileCallback);

describe("NodeIntegrationRuntime", () => {
  it("integrates only by making a new empty source working copy on the approved commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-subagents-integration-"));
    try {
      await execFile("jj", ["git", "init", "--colocate", root]);
      await writeFile(join(root, "README.md"), "base\n");
      await execFile("jj", ["describe", "-m", "base"], { cwd: root });
      const base = (await execFile("jj", ["log", "--no-graph", "-r", "@", "-T", "commit_id"], { cwd: root })).stdout.trim();
      await execFile("jj", ["new", base], { cwd: root });
      await writeFile(join(root, "README.md"), "approved\n");
      await execFile("jj", ["describe", "-m", "approved"], { cwd: root });
      const approved = (await execFile("jj", ["log", "--no-graph", "-r", "@", "-T", "commit_id"], { cwd: root })).stdout.trim();
      await execFile("jj", ["new", base], { cwd: root });
      const runtime = new NodeIntegrationRuntime();
      const before = await runtime.inspectSource(root);

      await runtime.createEmptyWorkingCopy(root, approved);
      const after = await runtime.inspectSource(root);

      expect(before).toMatchObject({ parentCommitIds: [base], changedPaths: [], isConflicted: false });
      expect(after).toMatchObject({ parentCommitIds: [approved], changedPaths: [], isConflicted: false });
      expect(after.operationId).not.toBe(before.operationId);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
