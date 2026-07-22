import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import childExtension from "./child-extension.js";

const withRole = async (role: "worker" | "reviewer", test: (tools: readonly string[]) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "pi-subagents-child-extension-"));
  const previous = process.env.PI_SUBAGENTS_GUARD_CONFIG;
  try {
    process.env.PI_SUBAGENTS_GUARD_CONFIG = JSON.stringify({
      schemaVersion: 1,
      role,
      root,
      allowedTrackedPaths: ["README.md"],
      resultPath: join(root, ".pi-subagents", "runs", "run-1", "tasks", "task-1", "attempts", "attempt-1", "output", `${role}-result.v1.json`),
      envelope: {
        schemaVersion: 1,
        runId: "run-1",
        taskId: "task-1",
        attemptId: "attempt-1",
        role,
        task: "task",
        root,
        allowedTrackedPaths: ["README.md"],
        assignedBaseCommitId: "base",
        outputRelativePath: `output/${role}-result.v1.json`,
      },
      maxReadBytes: 4096,
      maxOutputBytes: 4096,
    });
    const tools: string[] = [];
    childExtension({ registerTool: (tool: { name: string }) => tools.push(tool.name) } as never);
    await test(tools);
  } finally {
    if (previous === undefined) delete process.env.PI_SUBAGENTS_GUARD_CONFIG;
    else process.env.PI_SUBAGENTS_GUARD_CONFIG = previous;
    await rm(root, { recursive: true, force: true });
  }
};

describe("child guard extension", () => {
  it("registers the worker-only contained edit and narrow Jujutsu tools", async () => {
    await withRole("worker", async (tools) => {
      expect(tools).toEqual(expect.arrayContaining([
        "subagent_read",
        "subagent_search",
        "subagent_write",
        "subagent_edit",
        "subagent_jj_identity",
        "subagent_jj_describe",
        "subagent_write_result",
      ]));
      expect(tools).not.toContain("bash");
      expect(tools).not.toContain("subagent_jj_diff");
    });
  });

  it("registers reviewer-only read, search, diff, and result tools", async () => {
    await withRole("reviewer", async (tools) => {
      expect(tools).toEqual(expect.arrayContaining(["subagent_read", "subagent_search", "subagent_jj_diff", "subagent_write_result"]));
      expect(tools).not.toContain("subagent_write");
      expect(tools).not.toContain("subagent_edit");
      expect(tools).not.toContain("subagent_jj_describe");
    });
  });
});
