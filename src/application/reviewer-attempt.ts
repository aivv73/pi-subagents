import { childEnvironment, childPiArguments } from "./child-runtime.js";
import { validateReviewerDecision } from "../domain/reviewer-attempt.js";
import type { RunJournal } from "../ports/journal.js";
import type {
  BlockedReviewerAttempt,
  ReviewerAttemptRequest,
  ReviewerAttemptRuntime,
  RunningReviewerAttempt,
  StartedReviewerAttempt,
  SupervisedReviewerAttempt,
} from "../ports/reviewer-attempt.js";

const blocked = (attempt: Pick<RunningReviewerAttempt, "snapshot" | "agent" | "artifacts">, reason: string): BlockedReviewerAttempt => ({
  ...attempt,
  _tag: "blocked",
  reason,
});

const reviewPrompt = (request: ReviewerAttemptRequest): string =>
  `Review only exact commit ${request.reviewedCommitId} (change ${request.reviewedChangeId}) against base ${request.assignedBaseCommitId}. ` +
  `Inspect the fixed complete diff and contained files for identity, ancestry, one-change shape, declared scope, suspicious or unrelated changes, and this user request: ${request.userCommand}`;

/** Creates a reviewer snapshot only from coordinator state containing the fetched immutable ref. */
export const startReviewerAttempt = async (
  request: ReviewerAttemptRequest,
  runtime: ReviewerAttemptRuntime,
): Promise<StartedReviewerAttempt> => {
  const [sourceRef, sourceBase] = await Promise.all([
    runtime.resolveTransportRef(request.coordinatorRoot, request.transportRef),
    runtime.inspectRevision(request.coordinatorRoot, "@-", request.assignedBaseCommitId),
  ]);
  if (sourceRef.commitId !== request.reviewedCommitId || sourceRef.changeId !== request.reviewedChangeId || sourceBase.commitId !== request.assignedBaseCommitId) {
    throw new Error("fetched worker ref changed before reviewer snapshot creation");
  }
  const snapshot = await runtime.createExactSnapshot({ sourceRoot: request.coordinatorRoot, destination: request.snapshotDestination, name: request.snapshotName });
  const snapshotRef = await runtime.resolveTransportRef(snapshot.root, request.transportRef);
  if (snapshotRef.commitId !== request.reviewedCommitId || snapshotRef.changeId !== request.reviewedChangeId) {
    throw new Error("reviewer snapshot lacks the exact fetched worker ref");
  }
  const snapshotRevision = await runtime.currentRevision(snapshot.root);
  const envelope = {
    schemaVersion: 1 as const,
    runId: request.runId,
    taskId: request.taskId,
    attemptId: request.attemptId,
    role: "reviewer" as const,
    task: request.userCommand,
    root: snapshot.root,
    allowedTrackedPaths: [],
    assignedBaseCommitId: request.assignedBaseCommitId,
    outputRelativePath: "output/reviewer-result.v1.json",
  };
  const artifacts = await runtime.createArtifacts(snapshot.root, envelope);
  const guardConfig = {
    schemaVersion: 1 as const,
    role: "reviewer" as const,
    root: snapshot.root,
    allowedTrackedPaths: [],
    resultPath: artifacts.outputPath,
    envelope,
    reviewedCommitId: request.reviewedCommitId,
    reviewedBaseCommitId: request.assignedBaseCommitId,
    maxReadBytes: 256 * 1024,
    maxOutputBytes: 64 * 1024,
  };
  const agent = await runtime.startAgent({
    name: request.agentName,
    cwd: snapshot.root,
    argv: [request.piExecutable, "--model", request.parentModel, "--append-system-prompt", request.builtInPromptPath, ...childPiArguments(request.childExtensionPath)],
    environment: childEnvironment(request.parentEnvironment, guardConfig),
  });
  const startup = await runtime.waitForObservation(agent, "startup");
  if (startup === "blocked") return blocked({ snapshot, agent, artifacts }, "reviewer blocked before prompt submission");
  if (startup !== "ready") throw new Error("reviewer did not reach an interactive ready state");
  await runtime.sendPrompt(agent, reviewPrompt(request));
  return { _tag: "running", snapshot, agent, artifacts, snapshotRevision };
};

/** Herdr is liveness only; a decision becomes semantic only after immutable bindings and no-mutation checks. */
export const superviseReviewerAttempt = async (
  attempt: RunningReviewerAttempt,
  request: ReviewerAttemptRequest,
  runtime: ReviewerAttemptRuntime,
  journal: RunJournal,
  causationId: string,
): Promise<SupervisedReviewerAttempt> => {
  const observation = await runtime.waitForObservation(attempt.agent, "settlement");
  if (observation === "blocked") return blocked(attempt, "reviewer blocked while inspecting the revision");
  if (observation !== "settled") throw new Error("reviewer did not settle");
  const [result, facts, sourceRef, sourceBase, afterSnapshotRevision] = await Promise.all([
    runtime.readResult(attempt.artifacts),
    runtime.inspectRevision(attempt.snapshot.root, request.reviewedCommitId, request.assignedBaseCommitId),
    runtime.resolveTransportRef(request.coordinatorRoot, request.transportRef),
    runtime.inspectRevision(request.coordinatorRoot, "@-", request.assignedBaseCommitId),
    runtime.currentRevision(attempt.snapshot.root),
  ]);
  const issues = [...validateReviewerDecision(result, facts, {
    commitId: request.reviewedCommitId,
    changeId: request.reviewedChangeId,
    assignedBaseCommitId: request.assignedBaseCommitId,
    allowedTrackedPaths: request.allowedTrackedPaths,
  })];
  if (sourceRef.commitId !== request.reviewedCommitId || sourceRef.changeId !== request.reviewedChangeId) {
    issues.push({ code: "identity_mismatch", message: "fetched transport ref changed during review" });
  }
  if (sourceBase.commitId !== request.assignedBaseCommitId) {
    issues.push({ code: "wrong_base", message: "coordinator assigned base changed during review" });
  }
  if (afterSnapshotRevision.commitId !== attempt.snapshotRevision.commitId || afterSnapshotRevision.changeId !== attempt.snapshotRevision.changeId) {
    issues.push({ code: "invalid_revision", message: "reviewer snapshot tracked state changed during review" });
  }
  if (issues.length > 0 || result._tag !== "reviewer") return { _tag: "invalid_result", attempt, issues };
  await journal.append({
    causationId,
    correlationId: request.runId,
    payload: result.decision === "approved"
      ? { _tag: "review_approved", commitId: result.commitId }
      : { _tag: "review_revision_requested", commitId: result.commitId, findings: result.findings },
  });
  return { _tag: "reviewed", attempt, result, facts };
};
