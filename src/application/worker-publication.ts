import { attemptTransportRef, type ExactWorkerRevision } from "../domain/git-transport.js";
import { validateWorkerResult } from "../domain/worker-attempt.js";
import type { GitTransport, FetchedTransportRevision } from "../ports/git-transport.js";
import type { RunJournal } from "../ports/journal.js";
import type { ValidatedWorkerAttempt, WorkerAttemptRuntime } from "../ports/worker-attempt.js";

export class WorkerPublicationError extends Error {
  override readonly name = "WorkerPublicationError";
}

export interface PublishWorkerAttemptRequest {
  readonly stateDirectory: string;
  readonly coordinatorRoot: string;
  readonly causationId: string;
}

/** Rechecks mutable worker facts, journals the effect, then transports one exact revision. */
export const publishValidatedWorkerAttempt = async (
  attempt: ValidatedWorkerAttempt,
  request: PublishWorkerAttemptRequest,
  runtime: WorkerAttemptRuntime,
  transport: GitTransport,
  journal: RunJournal,
): Promise<FetchedTransportRevision> => {
  const currentResult = await runtime.readResult(attempt.attempt.artifacts);
  const currentFacts = await runtime.inspectWorkerRevision(
    attempt.attempt.snapshot.root,
    attempt.facts.assignedBaseCommitId,
  );
  const issues = validateWorkerResult(currentResult, currentFacts, {
    copiedChangeId: attempt.attempt.copiedChange.changeId,
    taskChangeId: attempt.attempt.taskChange.changeId,
    assignedBaseCommitId: attempt.facts.assignedBaseCommitId,
    allowedTrackedPaths: attempt.attempt.artifacts.envelope.allowedTrackedPaths,
  });
  if (issues.length > 0) throw new WorkerPublicationError(`worker revision changed after validation: ${issues.map((issue) => issue.code).join(", ")}`);
  if (
    currentResult._tag !== "worker" ||
    attempt.result._tag !== "worker" ||
    currentResult.commitId !== attempt.result.commitId ||
    currentResult.changeId !== attempt.result.changeId ||
    currentFacts.commitId !== attempt.facts.commitId ||
    currentFacts.changeId !== attempt.facts.changeId
  ) {
    throw new WorkerPublicationError("worker artifact or revision is stale after validation");
  }

  const revision: ExactWorkerRevision = {
    workerRoot: attempt.attempt.snapshot.root,
    assignedBaseCommitId: currentFacts.assignedBaseCommitId,
    changeId: currentFacts.changeId,
    commitId: currentFacts.commitId,
    transportRef: attemptTransportRef({
      runId: currentResult.runId,
      taskId: currentResult.taskId,
      attemptId: currentResult.attemptId,
    }),
  };
  const mutationId = `transport-${currentResult.attemptId}-${currentResult.commitId}`;
  const intent = await journal.append({
    causationId: request.causationId,
    correlationId: currentResult.runId,
    payload: { _tag: "external_intent", mutationId, operation: `publish ${revision.transportRef}` },
  });
  let fetched: FetchedTransportRevision;
  try {
    fetched = await transport.publishAndFetch({
      stateDirectory: request.stateDirectory,
      coordinatorRoot: request.coordinatorRoot,
      revision,
    });
    if (
      fetched.transportRef !== revision.transportRef ||
      fetched.remoteCommitId !== revision.commitId ||
      fetched.fetchedCommitId !== revision.commitId ||
      fetched.fetchedChangeId !== revision.changeId
    ) {
      throw new WorkerPublicationError("transport did not preserve the exact validated worker identity");
    }
  } catch (error) {
    await journal.append({
      causationId: intent.eventId,
      correlationId: currentResult.runId,
      payload: { _tag: "external_outcome", mutationId, outcome: "failed" },
    });
    throw error;
  }
  // If this durable outcome cannot be appended, retain the prior intent for manual recovery;
  // never overwrite it with a fabricated failure after a successful external mutation.
  await journal.append({
    causationId: intent.eventId,
    correlationId: currentResult.runId,
    payload: { _tag: "external_outcome", mutationId, outcome: "succeeded" },
  });
  return fetched;
};
