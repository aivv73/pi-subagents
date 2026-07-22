import { describe, expect, it } from "vitest";

import { runOneRevisionCycle } from "./revision-cycle.js";
import type { GitTransport } from "../ports/git-transport.js";
import type { RunJournal } from "../ports/journal.js";
import type { ReviewerAttemptRuntime } from "../ports/reviewer-attempt.js";
import type { ValidatedWorkerAttempt, WorkerAttemptRuntime } from "../ports/worker-attempt.js";

const oldResult = { _tag: "worker" as const, schemaVersion: 1 as const, runId: "run-1", taskId: "task-1", attemptId: "worker-1", changeId: "task-change", commitId: "old-commit", changedPaths: ["README.md"] };
const revisedResult = { ...oldResult, commitId: "new-commit" };
const facts = (commitId: string) => ({ changeId: "task-change", commitId, assignedBaseCommitId: "base", parentCommitIds: ["base"], revisionCommitIds: [commitId], isDescendantOfAssignedBase: true, isConflicted: false, description: "Update README", changedPaths: ["README.md"], trackedArtifactPaths: [] });
const worker: ValidatedWorkerAttempt = {
  _tag: "validated", result: oldResult, facts: facts("old-commit"),
  attempt: {
    _tag: "running", snapshot: { id: "worker", root: "/worker" }, agent: { name: "worker", paneId: "worker-pane" },
    artifacts: { root: "/worker", directory: "/artifact", inputPath: "/input", checksumPath: "/checksum", outputPath: "/output", evidenceDirectory: "/evidence", envelope: { schemaVersion: 1, runId: "run-1", taskId: "task-1", attemptId: "worker-1", role: "worker", task: "Update README", root: "/worker", allowedTrackedPaths: ["README.md"], assignedBaseCommitId: "base", outputRelativePath: "output/worker-result.v1.json" } },
    copiedChange: { changeId: "copied", commitId: "copied" }, taskChange: { changeId: "task-change", commitId: "old-commit" },
  },
};

const rejectedReview = {
  _tag: "reviewed" as const, attempt: {} as never, facts: facts("old-commit"),
  result: { _tag: "reviewer" as const, schemaVersion: 1 as const, runId: "run-1", taskId: "task-1", attemptId: "review-1", commitId: "old-commit", assignedBaseCommitId: "base", decision: "revision_requested" as const, findings: "Add an acceptance case." },
};

describe("one reviewer revision cycle", () => {
  it("reuses the original worker identities, requires an amended commit, republishes under the old-commit lease, and creates fresh approval", async () => {
    const prompts: string[] = [];
    const workerRuntime: WorkerAttemptRuntime = {
      sendPrompt: async (_agent, prompt) => { prompts.push(prompt); }, waitForObservation: async () => "settled",
      readResult: async () => revisedResult, inspectWorkerRevision: async () => facts("new-commit"),
    } as WorkerAttemptRuntime;
    const reviewerRuntime: ReviewerAttemptRuntime = {
      resolveTransportRef: async () => ({ commitId: "new-commit", changeId: "task-change" }),
      inspectRevision: async (_root, revision) => revision === "@-" ? facts("base") : facts("new-commit"),
      createExactSnapshot: async () => ({ id: "reviewer-2", root: "/reviewer" }), currentRevision: async () => ({ commitId: "snapshot", changeId: "snapshot" }),
      createArtifacts: async () => ({ ...worker.attempt.artifacts, root: "/reviewer", outputPath: "/review-output", envelope: { ...worker.attempt.artifacts.envelope, role: "reviewer", attemptId: "review-2", root: "/reviewer", allowedTrackedPaths: [], outputRelativePath: "output/reviewer-result.v1.json" } } as never),
      startAgent: async () => ({ name: "reviewer", paneId: "reviewer-pane" }), waitForObservation: async (agent, phase) => phase === "startup" ? "ready" : "settled", sendPrompt: async () => undefined,
      readResult: async () => ({ _tag: "reviewer", schemaVersion: 1, runId: "run-1", taskId: "task-1", attemptId: "review-2", commitId: "new-commit", assignedBaseCommitId: "base", decision: "approved", findings: "" }),
    };
    const transportCalls: unknown[] = [];
    const transport: GitTransport = { publishAndFetch: async (value) => { transportCalls.push(value); return { transportRef: value.revision.transportRef, remoteCommitId: "new-commit", fetchedCommitId: "new-commit", fetchedChangeId: "task-change" }; } };
    const drafts: unknown[] = [];
    const journal: RunJournal = { path: "/journal", runId: "run-1", append: async (draft) => { drafts.push(draft); return { eventId: `event-${drafts.length}` } as never; } };

    const result = await runOneRevisionCycle({
      rejectedReview, originalWorker: worker, workerRuntime, transport, journal, causationId: "cause",
      publication: { stateDirectory: "/state", coordinatorRoot: "/source", causationId: "cause" },
      reviewerRuntime, reviewerRequest: { runId: "run-1", taskId: "task-1", attemptId: "review-2", userCommand: "Update README", coordinatorRoot: "/source", snapshotDestination: "/reviewer", snapshotName: "reviewer-2", agentName: "reviewer", transportRef: "pi-subagents/run-1/task-1/worker-1", assignedBaseCommitId: "base", allowedTrackedPaths: ["README.md"], childExtensionPath: "/child", builtInPromptPath: "/reviewer", piExecutable: "pi", parentModel: "model", parentEnvironment: {} },
    });
    expect(result).toMatchObject({ _tag: "revised_and_reviewed", revised: { attempt: { snapshot: { root: "/worker" }, taskChange: { changeId: "task-change" } }, result: { commitId: "new-commit" } }, review: { _tag: "reviewed" } });
    expect(prompts[0]).toContain("Add an acceptance case.");
    expect(transportCalls[0]).toMatchObject({ previousCommitId: "old-commit", revision: { commitId: "new-commit" } });
    expect(drafts.map((draft) => (draft as { payload: { _tag: string } }).payload._tag)).toEqual(["external_intent", "external_outcome", "worker_revised", "review_approved"]);
  });
});
