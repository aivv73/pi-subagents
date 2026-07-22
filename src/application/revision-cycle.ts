import { publishValidatedWorkerAttempt, type PublishWorkerAttemptRequest } from "./worker-publication.js";
import { startReviewerAttempt, superviseReviewerAttempt } from "./reviewer-attempt.js";
import { validateWorkerResult } from "../domain/worker-attempt.js";
import { ReducerError } from "../domain/reducer.js";
import type { GitTransport, FetchedTransportRevision } from "../ports/git-transport.js";
import type { RunJournal } from "../ports/journal.js";
import type { ReviewerAttemptRequest, ReviewerAttemptRuntime, SupervisedReviewerAttempt } from "../ports/reviewer-attempt.js";
import type { ReviewedDecision } from "../ports/reviewer-attempt.js";
import type { ValidatedWorkerAttempt, WorkerAttemptRuntime } from "../ports/worker-attempt.js";

export type RevisionCycleResult =
  | { readonly _tag: "revised_and_reviewed"; readonly revised: ValidatedWorkerAttempt; readonly publication: FetchedTransportRevision; readonly review: SupervisedReviewerAttempt }
  | { readonly _tag: "worker_blocked"; readonly reason: string }
  | { readonly _tag: "invalid_revision"; readonly issues: readonly string[] }
  | { readonly _tag: "revision_budget_exhausted"; readonly reason: string };

const feedbackPrompt = (review: ReviewedDecision): string =>
  `The separate reviewer requested one revision for exact commit ${review.result.commitId}. ` +
  `Address these findings in the same assigned change, preserve the declared scope, describe the amended change, and replace the worker result artifact: ${review.result.findings}`;

/**
 * Consumes only a valid first reviewer rejection. It reuses the original worker pane,
 * Rift root, and change ID; protocol failure or blocked execution never becomes a review cycle.
 */
export const runOneRevisionCycle = async (input: {
  readonly rejectedReview: ReviewedDecision;
  readonly originalWorker: ValidatedWorkerAttempt;
  readonly workerRuntime: WorkerAttemptRuntime;
  readonly transport: GitTransport;
  readonly publication: Omit<PublishWorkerAttemptRequest, "previousCommitId">;
  readonly reviewerRequest: Omit<ReviewerAttemptRequest, "reviewedCommitId" | "reviewedChangeId">;
  readonly reviewerRuntime: ReviewerAttemptRuntime;
  readonly journal: RunJournal;
  readonly causationId: string;
}): Promise<RevisionCycleResult> => {
  if (input.rejectedReview.result.decision !== "revision_requested") {
    return { _tag: "invalid_revision", issues: ["only a reviewer revision request can start a revision cycle"] };
  }
  if (
    input.rejectedReview.result.commitId !== input.originalWorker.result.commitId ||
    input.rejectedReview.result.assignedBaseCommitId !== input.originalWorker.facts.assignedBaseCommitId
  ) {
    return { _tag: "invalid_revision", issues: ["review rejection is not bound to the original validated worker revision"] };
  }

  await input.workerRuntime.sendPrompt(input.originalWorker.attempt.agent, feedbackPrompt(input.rejectedReview));
  const workerObservation = await input.workerRuntime.waitForObservation(input.originalWorker.attempt.agent, "settlement");
  if (workerObservation === "blocked") return { _tag: "worker_blocked", reason: "worker blocked while addressing reviewer findings" };
  if (workerObservation !== "settled") return { _tag: "invalid_revision", issues: ["worker did not settle after revision request"] };

  const [result, facts] = await Promise.all([
    input.workerRuntime.readResult(input.originalWorker.attempt.artifacts),
    input.workerRuntime.inspectWorkerRevision(input.originalWorker.attempt.snapshot.root, input.originalWorker.facts.assignedBaseCommitId),
  ]);
  if (result._tag !== "worker") return { _tag: "invalid_revision", issues: ["revision worker output is not a worker result"] };
  const issues = [...validateWorkerResult(result, facts, {
    copiedChangeId: input.originalWorker.attempt.copiedChange.changeId,
    taskChangeId: input.originalWorker.attempt.taskChange.changeId,
    assignedBaseCommitId: input.originalWorker.facts.assignedBaseCommitId,
    allowedTrackedPaths: input.originalWorker.attempt.artifacts.envelope.allowedTrackedPaths,
  })];
  if (facts.commitId === input.originalWorker.result.commitId) issues.push({ code: "identity_mismatch", message: "revision must amend the previously reviewed commit" });
  if (issues.length > 0) return { _tag: "invalid_revision", issues: issues.map((issue) => issue.message) };

  const revised: ValidatedWorkerAttempt = { _tag: "validated", attempt: input.originalWorker.attempt, result, facts };
  const publication = await publishValidatedWorkerAttempt(
    revised,
    { ...input.publication, previousCommitId: input.originalWorker.result.commitId },
    input.workerRuntime,
    input.transport,
    input.journal,
  );
  await input.journal.append({
    causationId: input.causationId,
    correlationId: result.runId,
    payload: { _tag: "worker_revised", commitId: result.commitId },
  });

  const reviewerRequest: ReviewerAttemptRequest = {
    ...input.reviewerRequest,
    reviewedCommitId: result.commitId,
    reviewedChangeId: result.changeId,
    assignedBaseCommitId: facts.assignedBaseCommitId,
  };
  const startedReview = await startReviewerAttempt(reviewerRequest, input.reviewerRuntime);
  if (startedReview._tag === "blocked") return { _tag: "worker_blocked", reason: startedReview.reason };
  try {
    const review = await superviseReviewerAttempt(startedReview, reviewerRequest, input.reviewerRuntime, input.journal, input.causationId);
    if (review._tag === "reviewed" && review.result.decision === "revision_requested") {
      const reason = "revision budget exhausted: reviewer requested a second revision";
      await input.journal.append({ causationId: input.causationId, correlationId: result.runId, payload: { _tag: "run_failed", reason } });
      return { _tag: "revision_budget_exhausted", reason };
    }
    return { _tag: "revised_and_reviewed", revised, publication, review };
  } catch (error) {
    // The reducer rejects a second revision request. Preserve diagnostics and make the terminal
    // failure explicit instead of allowing that rejection to launch another worker amendment.
    if (!(error instanceof ReducerError)) throw error;
    const reason = `revision budget exhausted: ${error.message}`;
    await input.journal.append({ causationId: input.causationId, correlationId: result.runId, payload: { _tag: "run_failed", reason } });
    return { _tag: "revision_budget_exhausted", reason };
  }
};
