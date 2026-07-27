import { describe, expect, it } from "vitest";
import { terminalProgress, terminalSummary } from "./terminal-summary.js";

describe("terminal run summaries", () => {
  it("keeps only sanitized semantic identities out of retained resources", () => {
    const summary = terminalSummary("run-1", {
      _tag: "failed", reason: "untrusted terminal output", retained: {
        sourceRoot: "/secret/project", stateDirectory: "/secret/state", transportRef: "pi-subagents/run-1/task/attempt",
        transportCommitId: "commit", agents: [{ name: "worker\nraw", paneId: "pane-1" }], rifts: [{ id: "rift-1", root: "/secret/rift" }],
      },
    });
    expect(summary).toEqual({ runId: "run-1", disposition: "failed", retainedResourceIds: ["agent:[redacted]", "pane:pane-1", "rift:rift-1", "ref:pi-subagents/run-1/task/attempt"] });
    expect(JSON.stringify(summary)).not.toContain("/secret");
  });

  it("reports exact integrated commit only after successful integration", () => {
    const summary = terminalSummary("run-1", { _tag: "succeeded", approvedCommitId: "commit-1" });
    expect(terminalProgress(summary)).toMatchObject({ phase: "succeeded", integratedCommitId: "commit-1" });
  });
});
