import { describe, expect, it } from "vitest";

import type { AttemptArtifacts } from "../ports/artifacts.js";
import type { GitTransport } from "../ports/git-transport.js";
import type { IntegrationRuntime, SourceIntegrationFacts } from "../ports/integration.js";
import type { JournalEventDraft, RunJournal } from "../ports/journal.js";
import type { ReviewerAttemptRuntime } from "../ports/reviewer-attempt.js";
import type { TerminalResourceRuntime } from "../ports/terminal-resources.js";
import type { WorkerAttemptRuntime } from "../ports/worker-attempt.js";
import { DirectRunSupervisor, type DirectRunDependencies, type DirectRunRequest } from "../application/direct-run-supervisor.js";
import { SingleRunRegistry } from "../application/run-registry.js";

type Scenario = { readonly decisions?: readonly ("approved" | "revision_requested")[]; readonly invalidWorker?: boolean; readonly dirtySource?: boolean; readonly cleanupWarning?: boolean; readonly workerSettlement?: Promise<"settled">; };
const fact = (commitId: string, changeId = "task-change") => ({ commitId, changeId, assignedBaseCommitId: "base", parentCommitIds: ["base"], revisionCommitIds: [commitId], isDescendantOfAssignedBase: true, isConflicted: false, description: "update README", changedPaths: ["README.md"], trackedArtifactPaths: [] });

class ScriptedJournal implements RunJournal {
  readonly path = "/disposable/state/runs/run.jsonl";
  readonly runId = "run";
  readonly drafts: JournalEventDraft[] = [];
  async append(draft: JournalEventDraft) { this.drafts.push(draft); return { eventId: `event-${this.drafts.length}` } as never; }
}

class ScriptedRuntime implements WorkerAttemptRuntime, ReviewerAttemptRuntime {
  #revision = 1;
  #review = 0;
  readonly prompts: string[] = [];
  constructor(private readonly scenario: Scenario) {}
  get commit(): string { return `commit-${this.#revision}`; }
  async createExactSnapshot(request: { readonly destination: string; readonly name: string }) { return { id: request.name, root: request.destination }; }
  async currentRevision(root: string) { return root.includes("reviewer") ? { commitId: `review-copy-${root}`, changeId: `review-change-${root}` } : { commitId: "copied", changeId: "copied-change" }; }
  async createFreshTaskChange() { return { commitId: "task-working", changeId: "task-change" }; }
  async createArtifacts(root: string, envelope: AttemptArtifacts["envelope"]): Promise<AttemptArtifacts> { return { root, directory: `${root}/.pi-subagents`, inputPath: "input", checksumPath: "checksum", outputPath: "output", evidenceDirectory: "evidence", envelope }; }
  async readResult(artifacts: AttemptArtifacts) {
    const envelope = artifacts.envelope;
    if (envelope.role === "worker") {
      if (this.scenario.invalidWorker) return { _tag: "reviewer" as const, schemaVersion: 1 as const, runId: envelope.runId, taskId: envelope.taskId, attemptId: envelope.attemptId, commitId: this.commit, assignedBaseCommitId: "base", decision: "approved" as const, findings: "wrong role" };
      return { _tag: "worker" as const, schemaVersion: 1 as const, runId: envelope.runId, taskId: envelope.taskId, attemptId: envelope.attemptId, changeId: "task-change", commitId: this.commit, changedPaths: ["README.md"] };
    }
    const decision = this.scenario.decisions?.[this.#review++] ?? "approved";
    return { _tag: "reviewer" as const, schemaVersion: 1 as const, runId: envelope.runId, taskId: envelope.taskId, attemptId: envelope.attemptId, commitId: this.commit, assignedBaseCommitId: "base", decision, findings: decision === "approved" ? "approved" : "amend README" };
  }
  async inspectWorkerRevision() { return fact(this.commit); }
  async inspectRevision(_root: string, revision: string) { return revision === "@-" ? fact("base", "base-change") : fact(this.commit); }
  async resolveTransportRef() { return { commitId: this.commit, changeId: "task-change" }; }
  async startAgent(request: { readonly name: string }) { return { name: request.name, paneId: `pane-${request.name}` }; }
  async waitForObservation(agent: { readonly name: string }, phase: "startup" | "settlement") {
    if (phase === "startup") return "ready" as const;
    if (agent.name.startsWith("pi-subagents-worker") && this.scenario.workerSettlement !== undefined) return this.scenario.workerSettlement;
    return "settled" as const;
  }
  async sendPrompt(agent: { readonly name: string }, prompt: string) { this.prompts.push(prompt); if (agent.name.startsWith("pi-subagents-worker") && prompt.includes("separate reviewer requested")) this.#revision = 2; }
}

const disposable = (scenario: Scenario = {}) => {
  const journal = new ScriptedJournal();
  const runtime = new ScriptedRuntime(scenario);
  const registry = new SingleRunRegistry();
  const publications: Array<{ readonly commit: string; readonly previous: string | undefined }> = [];
  const cleanup: string[] = [];
  let integrated = false;
  const ids = ["run", "command", "task", "worker-attempt", "review-attempt", "revised-review-attempt"];
  const dependencies: DirectRunDependencies = {
    ids: { next: () => ids.shift() ?? `id-${ids.length}` }, journals: { async open() { return journal; } }, registry,
    snapshots: { destination: (role, id) => `/disposable/${role}-${id}`, name: (role, id) => `${role}-${id}` }, workerRuntime: runtime, reviewerRuntime: runtime,
    transport: { async publishAndFetch(request) { publications.push({ commit: request.revision.commitId, previous: request.previousCommitId }); return { transportRef: request.revision.transportRef, remoteCommitId: request.revision.commitId, fetchedCommitId: request.revision.commitId, fetchedChangeId: request.revision.changeId }; } } satisfies GitTransport,
    integrationRuntime: {
      async inspectSource(): Promise<SourceIntegrationFacts> { return { commitId: integrated ? "new-working" : "working", changeId: "working-change", parentCommitIds: [integrated ? runtime.commit : "base"], changedPaths: scenario.dirtySource ? ["README.md"] : [], isConflicted: false, operationId: integrated ? "op-after" : "op-before" }; },
      async inspectRevision(_root, revision) { return revision === "@-" ? fact("base", "base-change") : fact(runtime.commit); }, async resolveTransportRef() { return { commitId: runtime.commit, changeId: "task-change" }; }, async createEmptyWorkingCopy() { integrated = true; },
    } satisfies IntegrationRuntime,
    terminalRuntime: {
      async requestCooperativeStop() {}, async waitForStop() { return true; }, async sendInterrupt() {},
      async deleteTransportRef() { cleanup.push("ref"); if (scenario.cleanupWarning) throw new Error("lease warning"); }, async closePane() { cleanup.push("pane"); }, async removeRift() { cleanup.push("rift"); }, async garbageCollectRifts() { cleanup.push("gc"); },
    } satisfies TerminalResourceRuntime,
  };
  const request: DirectRunRequest = { task: "update README", sourceRoot: "/disposable/source", stateDirectory: "/disposable/state", assignedBaseCommitId: "base", allowedTrackedPaths: ["README.md"], childExtensionPath: "/child", workerPromptPath: "/worker", reviewerPromptPath: "/reviewer", piExecutable: "pi", parentModel: "model", parentEnvironment: {} };
  return { supervisor: new DirectRunSupervisor(dependencies), request, journal, runtime, publications, cleanup, registry };
};

const complete = async (fixture: ReturnType<typeof disposable>) => {
  const started = await fixture.supervisor.start(fixture.request);
  if (started._tag !== "started") throw new Error(`run did not start: ${started._tag}`);
  return started.completion;
};

describe("disposable direct-run acceptance", () => {
  it("revises the original worker change once, lease-republishes it, freshly reviews it, exactly integrates it, and cleans up", async () => {
    const fixture = disposable({ decisions: ["revision_requested", "approved"] });
    await expect(complete(fixture)).resolves.toEqual({ _tag: "succeeded", approvedCommitId: "commit-2" });
    expect(fixture.publications).toEqual([{ commit: "commit-1", previous: undefined }, { commit: "commit-2", previous: "commit-1" }]);
    expect(fixture.runtime.prompts).toEqual(expect.arrayContaining([expect.stringContaining("amend README")]));
    expect(fixture.journal.drafts.map((draft) => draft.payload._tag)).toEqual(expect.arrayContaining(["review_revision_requested", "worker_revised", "review_approved", "integration_succeeded", "cleanup_succeeded"]));
    expect(fixture.cleanup).toEqual(expect.arrayContaining(["ref", "pane", "rift", "gc"]));
    expect(fixture.registry.activeRunId).toBeUndefined();
  });

  it("retains and does not integrate malformed worker output or source drift", async () => {
    const malformed = disposable({ invalidWorker: true });
    await expect(complete(malformed)).resolves.toMatchObject({ _tag: "failed", reason: expect.stringContaining("invalid worker result") });
    expect(malformed.journal.drafts.map((draft) => draft.payload._tag)).not.toContain("integration_started");
    expect(malformed.cleanup).toEqual([]);

    const drifted = disposable({ dirtySource: true });
    await expect(complete(drifted)).resolves.toMatchObject({ _tag: "failed", reason: expect.stringContaining("integration blocked") });
    expect(drifted.journal.drafts.map((draft) => draft.payload._tag)).not.toContain("integration_started");
    expect(drifted.cleanup).toEqual([]);
  });

  it("retains a second reviewer rejection and preserves integration when cleanup only warns", async () => {
    const exhausted = disposable({ decisions: ["revision_requested", "revision_requested"] });
    await expect(complete(exhausted)).resolves.toMatchObject({ _tag: "failed", reason: expect.stringContaining("revision budget exhausted") });
    expect(exhausted.journal.drafts.map((draft) => draft.payload._tag)).toContain("run_failed");
    expect(exhausted.cleanup).toEqual([]);

    const warning = disposable({ cleanupWarning: true });
    await expect(complete(warning)).resolves.toMatchObject({ _tag: "succeeded_with_cleanup_warning", approvedCommitId: "commit-1" });
    expect(warning.journal.drafts.map((draft) => draft.payload._tag)).toContain("integration_succeeded");
    expect(warning.journal.drafts.map((draft) => draft.payload._tag)).toContain("cleanup_failed");
  });

  it("cancels the active disposable run without integrating or cleaning retained resources", async () => {
    let settle!: (value: "settled") => void;
    const fixture = disposable({ workerSettlement: new Promise((resolve) => { settle = resolve; }) });
    const started = await fixture.supervisor.start(fixture.request);
    if (started._tag !== "started") throw new Error("run did not start");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(started.cancel()).resolves.toEqual({ _tag: "cancelled" });
    settle("settled");
    await expect(started.completion).resolves.toMatchObject({ _tag: "cancelled" });
    expect(fixture.journal.drafts.map((draft) => draft.payload._tag)).toEqual(expect.arrayContaining(["cancellation_requested", "run_cancelled"]));
    expect(fixture.journal.drafts.map((draft) => draft.payload._tag)).not.toContain("integration_started");
    expect(fixture.cleanup).toEqual([]);
  });
});
