import { describe, expect, it } from "vitest";
import type { AttemptArtifacts } from "../ports/artifacts.js";
import type { GitTransport } from "../ports/git-transport.js";
import type { IntegrationRuntime, SourceIntegrationFacts } from "../ports/integration.js";
import type { JournalEventDraft, RunJournal } from "../ports/journal.js";
import type { ReviewerAttemptRuntime } from "../ports/reviewer-attempt.js";
import type { TerminalResourceRuntime } from "../ports/terminal-resources.js";
import type { WorkerAttemptRuntime } from "../ports/worker-attempt.js";
import { DirectRunSupervisor, type DirectRunDependencies, type DirectRunRequest } from "./direct-run-supervisor.js";
import { SingleRunRegistry } from "./run-registry.js";

const workerFacts = (commitId = "worker-commit", changeId = "task-change") => ({
  commitId, changeId, assignedBaseCommitId: "base", parentCommitIds: ["base"], revisionCommitIds: [commitId],
  isDescendantOfAssignedBase: true, isConflicted: false, description: "change", changedPaths: ["README.md"], trackedArtifactPaths: [],
});
const workerResult = { _tag: "worker" as const, schemaVersion: 1 as const, runId: "run", taskId: "task", attemptId: "worker-attempt", changeId: "task-change", commitId: "worker-commit", changedPaths: ["README.md"] };
const approvedResult = { _tag: "reviewer" as const, schemaVersion: 1 as const, runId: "run", taskId: "task", attemptId: "review-attempt", assignedBaseCommitId: "base", commitId: "worker-commit", decision: "approved" as const, findings: "approved" };

class MemoryJournal implements RunJournal {
  readonly path = "/state/runs/run.jsonl";
  readonly runId = "run";
  readonly events: JournalEventDraft[] = [];
  async append(draft: JournalEventDraft) {
    this.events.push(draft);
    return { eventId: `event-${this.events.length}` } as never;
  }
}

const artifacts = (root: string, envelope: AttemptArtifacts["envelope"]): AttemptArtifacts => ({
  root, directory: `${root}/.pi-subagents`, inputPath: "input", checksumPath: "checksum", outputPath: "output", evidenceDirectory: "evidence", envelope,
});

const runtime = (options: { readonly workerSettlement?: "settled" | "blocked" | Promise<"settled" | "blocked"> } = {}): WorkerAttemptRuntime & ReviewerAttemptRuntime => {
  const resultFor = (value: AttemptArtifacts) => value.envelope.role === "worker" ? workerResult : approvedResult;
  return {
    async createExactSnapshot(request) { return { id: request.name, root: request.destination }; },
    async currentRevision(root) { return root.includes("reviewer") ? { commitId: "review-current", changeId: "review-change" } : { commitId: "copied", changeId: "copied-change" }; },
    async createFreshTaskChange() { return { commitId: "task-commit", changeId: "task-change" }; },
    async createArtifacts(root, envelope) { return artifacts(root, envelope); },
    async readResult(value) { return resultFor(value); },
    async inspectWorkerRevision() { return workerFacts(); },
    async inspectRevision(_root, revision) { return revision === "@-" ? workerFacts("base", "base-change") : workerFacts(); },
    async resolveTransportRef() { return { commitId: "worker-commit", changeId: "task-change" }; },
    async startAgent(request) { return { name: request.name, paneId: `pane-${request.name}` }; },
    async waitForObservation(_agent, phase) {
      if (phase === "startup") return "ready";
      return await (options.workerSettlement ?? "settled");
    },
    async sendPrompt() {},
  };
};

const sourceFacts = (integrated = false, dirty = false): SourceIntegrationFacts => ({
  commitId: integrated ? "new-working-copy" : "working-copy", changeId: "working-change",
  parentCommitIds: [integrated ? "worker-commit" : "base"], changedPaths: dirty ? ["README.md"] : [], isConflicted: false,
  operationId: integrated ? "operation-after" : "operation-before",
});

const setup = (options: { readonly workerSettlement?: "settled" | "blocked" | Promise<"settled" | "blocked">; readonly dirtyIntegration?: boolean; readonly cleanupWarning?: boolean } = {}) => {
  const journal = new MemoryJournal();
  const registry = new SingleRunRegistry();
  let integrated = false;
  const terminalCalls: string[] = [];
  const dependencies: DirectRunDependencies = {
    ids: { next: (() => { const ids = ["run", "command", "task", "worker-attempt", "review-attempt", "revision-review-attempt"]; let i = 0; return () => ids[i++] ?? `id-${i}`; })() },
    journals: { async open() { return journal; } },
    snapshots: { destination: (role) => `/snapshots/${role}`, name: (role, id) => `${role}-${id}` },
    registry,
    workerRuntime: runtime(options), reviewerRuntime: runtime(options),
    transport: { async publishAndFetch(request) { return { transportRef: request.revision.transportRef, remoteCommitId: request.revision.commitId, fetchedCommitId: request.revision.commitId, fetchedChangeId: request.revision.changeId }; } } satisfies GitTransport,
    integrationRuntime: {
      async inspectSource() { return sourceFacts(integrated, options.dirtyIntegration); },
      async inspectRevision(_root, revision) { return revision === "@-" ? workerFacts("base", "base-change") : workerFacts(); },
      async resolveTransportRef() { return { commitId: "worker-commit", changeId: "task-change" }; },
      async createEmptyWorkingCopy() { integrated = true; },
    } satisfies IntegrationRuntime,
    terminalRuntime: {
      async requestCooperativeStop(agent) { terminalCalls.push(`stop:${agent.name}`); },
      async waitForStop() { return true; }, async sendInterrupt() { terminalCalls.push("interrupt"); },
      async deleteTransportRef() { terminalCalls.push("ref"); if (options.cleanupWarning) throw new Error("lease unavailable"); }, async closePane(agent) { terminalCalls.push(`close:${agent.name}`); },
      async removeRift(rift) { terminalCalls.push(`rift:${rift.id}`); }, async garbageCollectRifts() { terminalCalls.push("gc"); },
    } satisfies TerminalResourceRuntime,
  };
  const request: DirectRunRequest = {
    task: "update README", sourceRoot: "/source", stateDirectory: "/state", assignedBaseCommitId: "base", allowedTrackedPaths: ["README.md"],
    childExtensionPath: "/child.js", workerPromptPath: "/worker.md", reviewerPromptPath: "/reviewer.md", piExecutable: "pi", parentModel: "model", parentEnvironment: {},
  };
  return { supervisor: new DirectRunSupervisor(dependencies), journal, registry, terminalCalls, request };
};

describe("DirectRunSupervisor", () => {
  it("owns an exact approved run through integration and cleanup", async () => {
    const fixture = setup();
    const started = await fixture.supervisor.start(fixture.request);
    if (started._tag !== "started") throw new Error("expected run to start");
    await expect(started.completion).resolves.toEqual({ _tag: "succeeded", approvedCommitId: "worker-commit" });
    expect(fixture.journal.events.map((event) => event.payload._tag)).toEqual(expect.arrayContaining([
      "run_created", "worker_started", "worker_result_validated", "external_intent", "external_outcome", "review_approved", "integration_started", "integration_succeeded", "cleanup_succeeded",
    ]));
    expect(fixture.terminalCalls).toEqual(expect.arrayContaining(["ref", "gc"]));
    expect(fixture.registry.activeRunId).toBeUndefined();
  });

  it("retains a blocked worker and releases in-memory ownership", async () => {
    const fixture = setup({ workerSettlement: "blocked" });
    const started = await fixture.supervisor.start(fixture.request);
    if (started._tag !== "started") throw new Error("expected run to start");
    await expect(started.completion).resolves.toMatchObject({ _tag: "blocked", retained: { agents: [expect.anything()], rifts: [expect.anything()] } });
    expect(fixture.journal.events.map((event) => event.payload._tag)).toContain("agent_blocked");
    expect(fixture.registry.activeRunId).toBeUndefined();
  });

  it("cancels known resources before later validation or integration", async () => {
    let settle!: (value: "settled") => void;
    const fixture = setup({ workerSettlement: new Promise((resolve) => { settle = resolve; }) });
    const started = await fixture.supervisor.start(fixture.request);
    if (started._tag !== "started") throw new Error("expected run to start");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(started.cancel()).resolves.toEqual({ _tag: "cancelled" });
    settle("settled");
    await expect(started.completion).resolves.toMatchObject({ _tag: "cancelled", retained: { agents: [expect.anything()] } });
    expect(fixture.journal.events.map((event) => event.payload._tag)).toEqual(expect.arrayContaining(["cancellation_requested", "run_cancelled"]));
    expect(fixture.terminalCalls).toEqual(expect.arrayContaining([expect.stringMatching(/^stop:/)]));
    expect(fixture.registry.activeRunId).toBeUndefined();
  });

  it("retains source drift without integration or cleanup", async () => {
    const fixture = setup({ dirtyIntegration: true });
    const started = await fixture.supervisor.start(fixture.request);
    if (started._tag !== "started") throw new Error("expected run to start");
    await expect(started.completion).resolves.toMatchObject({ _tag: "failed", reason: expect.stringContaining("integration blocked") });
    expect(fixture.journal.events.map((event) => event.payload._tag)).not.toContain("integration_started");
    expect(fixture.terminalCalls).toEqual([]);
  });

  it("reports a cleanup warning without rolling back exact integration", async () => {
    const fixture = setup({ cleanupWarning: true });
    const started = await fixture.supervisor.start(fixture.request);
    if (started._tag !== "started") throw new Error("expected run to start");
    await expect(started.completion).resolves.toMatchObject({ _tag: "succeeded_with_cleanup_warning", approvedCommitId: "worker-commit" });
    expect(fixture.journal.events.map((event) => event.payload._tag)).toContain("cleanup_failed");
  });
});
