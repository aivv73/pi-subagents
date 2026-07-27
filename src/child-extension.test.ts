import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import childExtension from "./child-extension.js";

type RegisteredTool = { readonly name: string; readonly description: string };

const withRole = async (role: "worker" | "reviewer", test: (tools: readonly RegisteredTool[]) => Promise<void>): Promise<void> => {
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
      reviewedCommitId: role === "reviewer" ? "reviewed-commit" : undefined,
      reviewedBaseCommitId: role === "reviewer" ? "base" : undefined,
      maxReadBytes: 4096,
      maxOutputBytes: 4096,
    });
    const tools: RegisteredTool[] = [];
    childExtension({ registerTool: (tool: RegisteredTool) => tools.push(tool) } as never);
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
      const names = tools.map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining([
        "subagent_read",
        "subagent_search",
        "subagent_write",
        "subagent_edit",
        "subagent_jj_identity",
        "subagent_jj_describe",
        "subagent_write_result",
      ]));
      expect(names).not.toContain("bash");
      expect(names).not.toContain("subagent_jj_diff");
    });
  });

  it("registers reviewer-only read, search, diff, and result tools", async () => {
    await withRole("reviewer", async (tools) => {
      const names = tools.map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining(["subagent_read", "subagent_search", "subagent_jj_diff", "subagent_write_result"]));
      expect(names).not.toContain("subagent_write");
      expect(names).not.toContain("subagent_edit");
      expect(names).not.toContain("subagent_jj_describe");
    });
  });

  it("gives each role the exact coordinator fields required by its strict result", async () => {
    await withRole("worker", async (tools) => {
      const description = tools.find((tool) => tool.name === "subagent_write_result")?.description;
      expect(description).toContain('"runId":"run-1"');
      expect(description).toContain('"changeId":"<current change ID>"');
    });
    await withRole("reviewer", async (tools) => {
      const description = tools.find((tool) => tool.name === "subagent_write_result")?.description;
      expect(description).toContain('"commitId":"reviewed-commit"');
      expect(description).toContain('"assignedBaseCommitId":"base"');
    });
  });
});
