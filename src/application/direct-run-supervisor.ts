import { integrateApprovedChange } from "./integration.js";
import { runOneRevisionCycle } from "./revision-cycle.js";
import { SingleRunRegistry } from "./run-registry.js";
import { cancelAndRetain, cleanupIntegratedResources } from "./terminal-resources.js";
import { startWorkerAttempt, superviseWorkerAttempt } from "./worker-attempt.js";
import { publishValidatedWorkerAttempt } from "./worker-publication.js";
import { startReviewerAttempt, superviseReviewerAttempt } from "./reviewer-attempt.js";
import type { GitTransport, FetchedTransportRevision } from "../ports/git-transport.js";
import type { IntegrationRuntime } from "../ports/integration.js";
import type { RunJournal } from "../ports/journal.js";
import type { ReviewerAttemptRuntime, ReviewerAttemptRequest, ReviewedDecision } from "../ports/reviewer-attempt.js";
import type { RetainedAgent, RetainedRift, TerminalResourceRuntime, TerminalResources } from "../ports/terminal-resources.js";
import type { ValidatedWorkerAttempt, WorkerAttemptRuntime, WorkerAttemptRequest } from "../ports/worker-attempt.js";

export interface DirectRunIdSource { next(kind: "run" | "task" | "attempt" | "command"): string; }
export interface DirectRunJournalFactory { open(stateDirectory: string, runId: string): Promise<RunJournal>; }
export interface DirectRunSnapshotLayout { destination(role: "worker" | "reviewer", attemptId: string): string; name(role: "worker" | "reviewer", attemptId: string): string; }

export interface DirectRunRequest {
  readonly task: string;
  readonly sourceRoot: string;
  readonly stateDirectory: string;
  readonly assignedBaseCommitId: string;
  readonly allowedTrackedPaths: readonly string[];
  readonly childExtensionPath: string;
  readonly workerPromptPath: string;
  readonly reviewerPromptPath: string;
  readonly piExecutable: string;
  readonly parentModel: string;
  readonly parentEnvironment: NodeJS.ProcessEnv;
  readonly onProgress?: (progress: DirectRunProgress) => void;
}

/** Coordinator facts for an adapter; not agent lifecycle observations. */
export type DirectRunProgress =
  | { readonly phase: "worker_running" | "worker_validating" | "reviewing" | "revision_requested" | "integrating" | "cleaning" }
  | { readonly phase: "blocked" | "failed"; readonly detail: string }
  | { readonly phase: "cancelled" }
  | { readonly phase: "succeeded"; readonly approvedCommitId: string }
  | { readonly phase: "succeeded_with_cleanup_warning"; readonly approvedCommitId: string; readonly detail: string };

export interface DirectRunDependencies {
  readonly ids: DirectRunIdSource;
  readonly journals: DirectRunJournalFactory;
  readonly snapshots: DirectRunSnapshotLayout;
  readonly registry: SingleRunRegistry;
  readonly workerRuntime: WorkerAttemptRuntime;
  readonly reviewerRuntime: ReviewerAttemptRuntime;
  readonly transport: GitTransport;
  readonly integrationRuntime: IntegrationRuntime;
  readonly terminalRuntime: TerminalResourceRuntime;
}

export type DirectRunDisposition =
  | { readonly _tag: "succeeded"; readonly approvedCommitId: string }
  | { readonly _tag: "succeeded_with_cleanup_warning"; readonly approvedCommitId: string; readonly warnings: readonly string[] }
  | { readonly _tag: "cancelled"; readonly retained: TerminalResources }
  | { readonly _tag: "blocked"; readonly reason: string; readonly retained: TerminalResources }
  | { readonly _tag: "failed"; readonly reason: string; readonly retained: TerminalResources };

export type DirectRunStart =
  | { readonly _tag: "started"; readonly runId: string; readonly completion: Promise<DirectRunDisposition>; readonly cancel: () => Promise<{ readonly _tag: "cancelled" } | { readonly _tag: "too_late" }> }
  | { readonly _tag: "already_active"; readonly runId: string }
  | { readonly _tag: "start_failed"; readonly reason: string };

const retained = (input: DirectRunRequest, agents: readonly RetainedAgent[], rifts: readonly RetainedRift[], publication: FetchedTransportRevision | undefined): TerminalResources => ({
  sourceRoot: input.sourceRoot,
  agents,
  rifts,
  stateDirectory: input.stateDirectory,
  transportRef: publication?.transportRef,
  transportCommitId: publication?.remoteCommitId,
});

const retainReviewAttempt = (
  review: import("../ports/reviewer-attempt.js").SupervisedReviewerAttempt,
  agents: RetainedAgent[],
  rifts: RetainedRift[],
): void => {
  const attempt = review._tag === "invalid_result" || review._tag === "reviewed" ? review.attempt : review;
  rifts.push({ id: attempt.snapshot.id, root: attempt.snapshot.root });
  agents.push(attempt.agent);
};

const workerRequest = (input: DirectRunRequest, runId: string, taskId: string, attemptId: string, snapshots: DirectRunSnapshotLayout): WorkerAttemptRequest => ({
  runId, taskId, attemptId, userCommand: input.task, sourceRoot: input.sourceRoot,
  snapshotDestination: snapshots.destination("worker", attemptId), snapshotName: snapshots.name("worker", attemptId), agentName: `pi-subagents-worker-${attemptId}`,
  assignedBaseCommitId: input.assignedBaseCommitId, allowedTrackedPaths: input.allowedTrackedPaths,
  childExtensionPath: input.childExtensionPath, builtInPromptPath: input.workerPromptPath,
  piExecutable: input.piExecutable, parentModel: input.parentModel, parentEnvironment: input.parentEnvironment,
});

const reviewerRequest = (input: DirectRunRequest, runId: string, taskId: string, attemptId: string, publication: FetchedTransportRevision, worker: ValidatedWorkerAttempt & { readonly result: Extract<ValidatedWorkerAttempt["result"], { readonly _tag: "worker" }> }, snapshots: DirectRunSnapshotLayout): ReviewerAttemptRequest => ({
  runId, taskId, attemptId, userCommand: input.task, coordinatorRoot: input.sourceRoot,
  snapshotDestination: snapshots.destination("reviewer", attemptId), snapshotName: snapshots.name("reviewer", attemptId), agentName: `pi-subagents-reviewer-${attemptId}`,
  transportRef: publication.transportRef, reviewedCommitId: worker.result.commitId, reviewedChangeId: worker.result.changeId,
  assignedBaseCommitId: worker.facts.assignedBaseCommitId, allowedTrackedPaths: input.allowedTrackedPaths,
  childExtensionPath: input.childExtensionPath, builtInPromptPath: input.reviewerPromptPath,
  piExecutable: input.piExecutable, parentModel: input.parentModel, parentEnvironment: input.parentEnvironment,
});

/**
 * Owns one direct run after admission. Existing attempt services remain the authority for every
 * external operation; this class only sequences their validated results and retains ownership.
 */
export class DirectRunSupervisor {
  constructor(private readonly dependencies: DirectRunDependencies) {}

  async start(input: DirectRunRequest): Promise<DirectRunStart> {
    const runId = this.dependencies.ids.next("run");
    const claimed = this.dependencies.registry.claim(runId);
    if (claimed._tag === "already_active") return claimed;
    const commandId = this.dependencies.ids.next("command");
    let journal: RunJournal;
    try {
      journal = await this.dependencies.journals.open(input.stateDirectory, runId);
      await journal.append({ causationId: commandId, correlationId: runId, payload: { _tag: "run_created", task: input.task } });
    } catch (error) {
      this.dependencies.registry.release(runId);
      return { _tag: "start_failed", reason: error instanceof Error ? error.message : String(error) };
    }

    const taskId = this.dependencies.ids.next("task");
    const agents: RetainedAgent[] = [];
    const rifts: RetainedRift[] = [];
    let publication: FetchedTransportRevision | undefined;
    let cancellation: Promise<void> | undefined;
    let integrationStarted = false;
    const resources = (): TerminalResources => retained(input, agents, rifts, publication);
    const report = (progress: DirectRunProgress): void => input.onProgress?.(progress);
    const isCancelled = (): boolean => cancellation !== undefined;
    const cancel = async (): Promise<{ readonly _tag: "cancelled" } | { readonly _tag: "too_late" }> => {
      if (integrationStarted) return { _tag: "too_late" };
      if (cancellation === undefined) {
        cancellation = cancelAndRetain({
          runId, causationId: this.dependencies.ids.next("command"), agents: [...agents],
          runtime: this.dependencies.terminalRuntime, journal,
        }).then(() => undefined);
      }
      await cancellation;
      return { _tag: "cancelled" };
    };
    const cancelled = async (): Promise<DirectRunDisposition> => {
      await cancellation;
      report({ phase: "cancelled" });
      return { _tag: "cancelled", retained: resources() };
    };
    const fail = async (reason: string): Promise<DirectRunDisposition> => {
      if (isCancelled()) return cancelled();
      try { await journal.append({ causationId: commandId, correlationId: runId, payload: { _tag: "run_failed", reason } }); } catch { /* preserve the original failure and retained evidence */ }
      report({ phase: "failed", detail: reason });
      return { _tag: "failed", reason, retained: resources() };
    };
    const block = async (role: "worker" | "reviewer", reason: string): Promise<DirectRunDisposition> => {
      if (isCancelled()) return cancelled();
      try { await journal.append({ causationId: commandId, correlationId: runId, payload: { _tag: "agent_blocked", role, diagnostic: reason } }); } catch { /* preserve evidence */ }
      report({ phase: "blocked", detail: reason });
      return { _tag: "blocked", reason, retained: resources() };
    };

    const completion = (async (): Promise<DirectRunDisposition> => {
      try {
        const workerAttemptId = this.dependencies.ids.next("attempt");
        await journal.append({ causationId: commandId, correlationId: runId, payload: { _tag: "worker_started" } });
        report({ phase: "worker_running" });
        const startedWorker = await startWorkerAttempt(workerRequest(input, runId, taskId, workerAttemptId, this.dependencies.snapshots), this.dependencies.workerRuntime);
        rifts.push({ id: startedWorker.snapshot.id, root: startedWorker.snapshot.root });
        agents.push(startedWorker.agent);
        if (isCancelled()) return cancelled();
        if (startedWorker._tag === "blocked") return block("worker", startedWorker.reason);
        report({ phase: "worker_validating" });
        const worker = await superviseWorkerAttempt(startedWorker, input.assignedBaseCommitId, input.allowedTrackedPaths, this.dependencies.workerRuntime);
        if (isCancelled()) return cancelled();
        if (worker._tag === "blocked") return block("worker", worker.reason);
        if (worker._tag === "invalid_result") return fail(`invalid worker result: ${worker.issues.map((issue) => issue.code).join(", ")}`);
        if (worker.result._tag !== "worker") return fail("worker validation did not return a worker artifact");
        const validatedWorker = worker as ValidatedWorkerAttempt & { readonly result: Extract<ValidatedWorkerAttempt["result"], { readonly _tag: "worker" }> };
        await journal.append({ causationId: commandId, correlationId: runId, payload: { _tag: "worker_result_validated", commitId: worker.result.commitId } });
        publication = await publishValidatedWorkerAttempt(validatedWorker, { stateDirectory: input.stateDirectory, coordinatorRoot: input.sourceRoot, causationId: commandId }, this.dependencies.workerRuntime, this.dependencies.transport, journal);
        if (isCancelled()) return cancelled();

        const initialReviewerAttemptId = this.dependencies.ids.next("attempt");
        report({ phase: "reviewing" });
        const reviewRequest = reviewerRequest(input, runId, taskId, initialReviewerAttemptId, publication, validatedWorker, this.dependencies.snapshots);
        const startedReview = await startReviewerAttempt(reviewRequest, this.dependencies.reviewerRuntime);
        rifts.push({ id: startedReview.snapshot.id, root: startedReview.snapshot.root });
        agents.push(startedReview.agent);
        if (isCancelled()) return cancelled();
        if (startedReview._tag === "blocked") return block("reviewer", startedReview.reason);
        let review = await superviseReviewerAttempt(startedReview, reviewRequest, this.dependencies.reviewerRuntime, journal, commandId);
        if (isCancelled()) return cancelled();
        if (review._tag === "blocked") return block("reviewer", review.reason);
        if (review._tag === "invalid_result") return fail(`invalid reviewer result: ${review.issues.map((issue) => issue.code).join(", ")}`);

        let approved: ReviewedDecision;
        if (review.result.decision === "revision_requested") {
          report({ phase: "revision_requested" });
          const revisedReviewerAttemptId = this.dependencies.ids.next("attempt");
          const revisedRequest = reviewerRequest(input, runId, taskId, revisedReviewerAttemptId, publication, validatedWorker, this.dependencies.snapshots);
          const revision = await runOneRevisionCycle({
            rejectedReview: review, originalWorker: validatedWorker, workerRuntime: this.dependencies.workerRuntime, transport: this.dependencies.transport,
            publication: { stateDirectory: input.stateDirectory, coordinatorRoot: input.sourceRoot, causationId: commandId },
            reviewerRequest: revisedRequest, reviewerRuntime: this.dependencies.reviewerRuntime, journal, causationId: commandId,
          });
          if (isCancelled()) return cancelled();
          if (revision._tag === "worker_blocked") return block("worker", revision.reason);
          if (revision._tag === "invalid_revision") return fail(`invalid worker revision: ${revision.issues.join(", ")}`);
          if (revision._tag === "revision_budget_exhausted") return fail(revision.reason);
          publication = revision.publication;
          review = revision.review;
          retainReviewAttempt(review, agents, rifts);
          if (review._tag === "blocked") return block("reviewer", review.reason);
          if (review._tag === "invalid_result") return fail(`invalid revised reviewer result: ${review.issues.map((issue) => issue.code).join(", ")}`);
        }
        if (review.result.decision !== "approved") return fail("review did not produce approval");
        approved = review;
        if (isCancelled()) return cancelled();
        report({ phase: "integrating" });
        integrationStarted = true;
        const integration = await integrateApprovedChange({
          approval: approved, sourceRoot: input.sourceRoot, transportRef: publication.transportRef,
          assignedBaseCommitId: input.assignedBaseCommitId, allowedTrackedPaths: input.allowedTrackedPaths,
          runtime: this.dependencies.integrationRuntime, journal, causationId: commandId,
        });
        if (integration._tag === "blocked") return fail(`integration blocked: ${integration.reasons.join(", ")}`);
        report({ phase: "cleaning" });
        const cleanup = await cleanupIntegratedResources({ runId, causationId: commandId, resources: resources(), runtime: this.dependencies.terminalRuntime, journal });
        if (cleanup._tag === "succeeded") {
          report({ phase: "succeeded", approvedCommitId: integration.approvedCommitId });
          return { _tag: "succeeded", approvedCommitId: integration.approvedCommitId };
        }
        const detail = cleanup.warnings.join("; ");
        report({ phase: "succeeded_with_cleanup_warning", approvedCommitId: integration.approvedCommitId, detail });
        return { _tag: "succeeded_with_cleanup_warning", approvedCommitId: integration.approvedCommitId, warnings: cleanup.warnings };
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      } finally {
        this.dependencies.registry.release(runId);
      }
    })();
    return { _tag: "started", runId, completion, cancel };
  }
}
