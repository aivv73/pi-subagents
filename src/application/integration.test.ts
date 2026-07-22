import { describe, expect, it } from "vitest";

import { integrateApprovedChange } from "./integration.js";
import type { IntegrationRuntime } from "../ports/integration.js";
import type { RunJournal } from "../ports/journal.js";
import type { ReviewedDecision } from "../ports/reviewer-attempt.js";

const approved: ReviewedDecision = {
  _tag: "reviewed", attempt: {} as never,
  result: { _tag: "reviewer", schemaVersion: 1, runId: "run-1", taskId: "task-1", attemptId: "review-1", commitId: "approved", assignedBaseCommitId: "base", decision: "approved", findings: "" },
  facts: { commitId: "approved", changeId: "change", assignedBaseCommitId: "base", parentCommitIds: ["base"], revisionCommitIds: ["approved"], isDescendantOfAssignedBase: true, isConflicted: false, description: "Approved change", changedPaths: ["README.md"], trackedArtifactPaths: [] },
};

const source = (patch: Partial<{ parentCommitIds: readonly string[]; changedPaths: readonly string[]; isConflicted: boolean; operationId: string }> = {}) => ({
  commitId: "empty", changeId: "empty-change", parentCommitIds: ["base"], changedPaths: [], isConflicted: false, operationId: "op-before", ...patch,
});

const journal = () => {
  const drafts: unknown[] = [];
  const value: RunJournal = { path: "/journal", runId: "run-1", append: async (draft) => { drafts.push(draft); return { eventId: `event-${drafts.length}` } as never; } };
  return { value, drafts };
};

describe("approved integration", () => {
  it("journals intent, creates only a new empty source working copy, and verifies structural postconditions", async () => {
    let created: string | undefined;
    let sourceCalls = 0;
    const runtime: IntegrationRuntime = {
      inspectSource: async () => sourceCalls++ === 0 ? source() : source({ commitId: "new-empty", changeId: "new-change", parentCommitIds: ["approved"], operationId: "op-after" }),
      resolveTransportRef: async () => ({ commitId: "approved", changeId: "change" }),
      inspectRevision: async () => approved.facts,
      createEmptyWorkingCopy: async (_root, commit) => { created = commit; },
    };
    const events = journal();
    await expect(integrateApprovedChange({ approval: approved, sourceRoot: "/source", transportRef: "pi-subagents/run/task/attempt", assignedBaseCommitId: "base", allowedTrackedPaths: ["README.md"], runtime, journal: events.value, causationId: "cause" }))
      .resolves.toEqual({ _tag: "integrated", approvedCommitId: "approved", beforeOperationId: "op-before", afterOperationId: "op-after" });
    expect(created).toBe("approved");
    expect(events.drafts.map((draft) => (draft as { payload: { _tag: string } }).payload._tag)).toEqual(["integration_started", "integration_succeeded"]);
  });

  it("does not mutate source or journal integration when base/ref/conflict state is stale", async () => {
    let created = false;
    const runtime: IntegrationRuntime = {
      inspectSource: async () => source({ changedPaths: ["unrelated.txt"], isConflicted: true }),
      resolveTransportRef: async () => ({ commitId: "moved", changeId: "moved" }), inspectRevision: async () => approved.facts,
      createEmptyWorkingCopy: async () => { created = true; },
    };
    const events = journal();
    const result = await integrateApprovedChange({ approval: approved, sourceRoot: "/source", transportRef: "pi-subagents/run/task/attempt", assignedBaseCommitId: "base", allowedTrackedPaths: ["README.md"], runtime, journal: events.value, causationId: "cause" });
    expect(result).toMatchObject({ _tag: "blocked", reasons: expect.arrayContaining(["source @ is not empty", "source @ has a structural conflict", "fetched transport ref is stale"]) });
    expect(created).toBe(false);
    expect(events.drafts).toEqual([]);
  });
});
