import { describe, expect, it } from "vitest";

import { startReviewerAttempt, superviseReviewerAttempt } from "./reviewer-attempt.js";
import type { RunJournal } from "../ports/journal.js";
import type { ReviewerAttemptRequest, ReviewerAttemptRuntime } from "../ports/reviewer-attempt.js";

const request: ReviewerAttemptRequest = {
  runId: "run-1", taskId: "task-1", attemptId: "review-1", userCommand: "Update README correctly",
  coordinatorRoot: "/source", snapshotDestination: "/rift/reviewer-1", snapshotName: "reviewer-1", agentName: "reviewer-1",
  transportRef: "pi-subagents/run-1/task-1/worker-1", reviewedCommitId: "worker-commit", reviewedChangeId: "worker-change",
  assignedBaseCommitId: "base-commit", allowedTrackedPaths: ["README.md"], childExtensionPath: "/package/child.js",
  builtInPromptPath: "/package/reviewer.md", piExecutable: "pi", parentModel: "openai/gpt-5.6",
  parentEnvironment: { PATH: "/bin", OPENAI_API_KEY: "must-not-forward" },
};

const reviewerResult = {
  _tag: "reviewer" as const, schemaVersion: 1 as const, runId: "run-1", taskId: "task-1", attemptId: "review-1",
  commitId: "worker-commit", assignedBaseCommitId: "base-commit", decision: "approved" as const, findings: "",
};
const facts = {
  commitId: "worker-commit", changeId: "worker-change", assignedBaseCommitId: "base-commit", parentCommitIds: ["base-commit"],
  revisionCommitIds: ["worker-commit"], isDescendantOfAssignedBase: true, isConflicted: false, description: "Update README",
  changedPaths: ["README.md"], trackedArtifactPaths: [],
};
const artifacts = {
  root: "/rift/reviewer-1", directory: "/artifact", inputPath: "/input", checksumPath: "/checksum", outputPath: "/output", evidenceDirectory: "/evidence",
  envelope: {
    schemaVersion: 1 as const, runId: "run-1", taskId: "task-1", attemptId: "review-1", role: "reviewer" as const,
    task: "Update README correctly", root: "/rift/reviewer-1", allowedTrackedPaths: [], assignedBaseCommitId: "base-commit", outputRelativePath: "output/reviewer-result.v1.json",
  },
};

const runtime = (options: { readonly observations?: readonly ("ready" | "settled" | "blocked")[]; readonly changedRef?: boolean; readonly mutated?: boolean; readonly result?: typeof reviewerResult } = {}) => {
  const calls: string[] = [];
  let observation = 0;
  let current = 0;
  const value: ReviewerAttemptRuntime = {
    async resolveTransportRef(root) {
      calls.push(`ref:${root}`);
      if (options.changedRef && root === "/source" && calls.filter((call) => call === "ref:/source").length > 1) return { commitId: "moved", changeId: "moved" };
      return { commitId: "worker-commit", changeId: "worker-change" };
    },
    async createExactSnapshot() { calls.push("snapshot"); return { id: "reviewer-1", root: "/rift/reviewer-1" }; },
    async currentRevision() {
      calls.push("current");
      return options.mutated && current++ > 0 ? { commitId: "mutated", changeId: "mutated" } : { commitId: "snapshot", changeId: "snapshot" };
    },
    async createArtifacts(_root, envelope) { calls.push(`artifacts:${envelope.role}`); return artifacts; },
    async startAgent(start) { calls.push(`start:${start.argv.join(" ")}`); expect(start.environment).not.toHaveProperty("OPENAI_API_KEY"); return { name: "reviewer-1", paneId: "pane-1" }; },
    async waitForObservation(_agent, phase) { calls.push(`wait:${phase}`); return (options.observations ?? ["ready", "settled"])[observation++]!; },
    async sendPrompt(_agent, prompt) { calls.push(`prompt:${prompt}`); },
    async readResult() { calls.push("result"); return options.result ?? reviewerResult; },
    async inspectRevision(root, revision) {
      calls.push(`facts:${root}:${revision}`);
      if (root === "/source" && revision === "@-") return { ...facts, commitId: "base-commit", changeId: "base-change", parentCommitIds: ["root"], revisionCommitIds: ["base-commit"] };
      return facts;
    },
  };
  return { value, calls };
};

const journal = () => {
  const drafts: unknown[] = [];
  const value: RunJournal = { path: "/journal", runId: "run-1", append: async (draft) => { drafts.push(draft); return { eventId: `event-${drafts.length}` } as never; } };
  return { value, drafts };
};

describe("reviewer attempt", () => {
  it("uses a separate snapshot/ref, fixed reviewer guard, and journals only an exact approval", async () => {
    const { value, calls } = runtime();
    const started = await startReviewerAttempt(request, value);
    expect(started).toMatchObject({ _tag: "running", snapshot: { root: "/rift/reviewer-1" } });
    expect(calls).toEqual(expect.arrayContaining(["ref:/source", "snapshot", "ref:/rift/reviewer-1", "artifacts:reviewer", "wait:startup"]));
    expect(calls.find((call) => call.startsWith("prompt:"))).toContain("Update README correctly");
    expect(calls.find((call) => call.startsWith("start:"))).toContain("--no-builtin-tools");
    if (started._tag !== "running") throw new Error("expected running reviewer");
    const eventJournal = journal();
    await expect(superviseReviewerAttempt(started, request, value, eventJournal.value, "review-cause")).resolves.toMatchObject({ _tag: "reviewed", result: { decision: "approved" } });
    expect(eventJournal.drafts).toEqual([expect.objectContaining({ payload: { _tag: "review_approved", commitId: "worker-commit" } })]);
  });

  it("retains blocked reviewers and fails closed on tracked mutation or a moved fetched ref", async () => {
    const blockedRuntime = runtime({ observations: ["blocked"] });
    expect(await startReviewerAttempt(request, blockedRuntime.value)).toMatchObject({ _tag: "blocked", agent: { paneId: "pane-1" } });
    expect(blockedRuntime.calls.some((call) => call.startsWith("prompt:"))).toBe(false);

    for (const options of [{ mutated: true }, { changedRef: true }]) {
      const candidate = runtime(options);
      const started = await startReviewerAttempt(request, candidate.value);
      if (started._tag !== "running") throw new Error("expected running reviewer");
      const eventJournal = journal();
      expect(await superviseReviewerAttempt(started, request, candidate.value, eventJournal.value, "cause")).toMatchObject({ _tag: "invalid_result" });
      expect(eventJournal.drafts).toEqual([]);
    }
  });

  it("records only an identity-bound actionable revision request", async () => {
    const candidate = runtime({ result: { ...reviewerResult, decision: "revision_requested", findings: "Add the missing acceptance case." } });
    const started = await startReviewerAttempt(request, candidate.value);
    if (started._tag !== "running") throw new Error("expected running reviewer");
    const eventJournal = journal();
    await expect(superviseReviewerAttempt(started, request, candidate.value, eventJournal.value, "cause")).resolves.toMatchObject({
      _tag: "reviewed", result: { decision: "revision_requested" },
    });
    expect(eventJournal.drafts).toEqual([expect.objectContaining({ payload: expect.objectContaining({ _tag: "review_revision_requested", findings: "Add the missing acceptance case." }) })]);
  });
});
