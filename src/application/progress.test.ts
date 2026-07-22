import { describe, expect, it } from "vitest";
import { progressNotification, progressWidget } from "./progress.js";

describe("semantic progress", () => {
  it("never labels a process state as semantic approval or integration", () => {
    expect(progressWidget({ phase: "worker_validating", detail: "Herdr settled; artifact validation pending." }))
      .toEqual(["Subagents: Validating worker result", "Herdr settled; artifact validation pending."]);
  });
  it("reports retained resources and terminal cleanup warnings distinctly", () => {
    expect(progressNotification({ phase: "succeeded_with_cleanup_warning", integratedCommitId: "abc", retainedResources: ["rift-1"] }))
      .toMatchObject({ type: "warning", message: expect.stringContaining("Integrated: abc") });
    expect(progressNotification({ phase: "blocked", retainedResources: ["pane-1"] }))
      .toMatchObject({ type: "error", message: expect.stringContaining("Retained: pane-1") });
  });
});
