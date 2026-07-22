import { validateReviewerDecision } from "../domain/reviewer-attempt.js";
import type { RunJournal } from "../ports/journal.js";
import type { IntegrationRuntime } from "../ports/integration.js";
import type { ReviewedDecision } from "../ports/reviewer-attempt.js";

export type IntegrationResult =
  | { readonly _tag: "integrated"; readonly approvedCommitId: string; readonly beforeOperationId: string; readonly afterOperationId: string }
  | { readonly _tag: "blocked"; readonly reasons: readonly string[] };

/** Validates all mutable bindings before the sole source mutation, then proves the resulting empty @. */
export const integrateApprovedChange = async (input: {
  readonly approval: ReviewedDecision;
  readonly sourceRoot: string;
  readonly transportRef: string;
  readonly assignedBaseCommitId: string;
  readonly allowedTrackedPaths: readonly string[];
  readonly runtime: IntegrationRuntime;
  readonly journal: RunJournal;
  readonly causationId: string;
}): Promise<IntegrationResult> => {
  if (input.approval.result.decision !== "approved") return { _tag: "blocked", reasons: ["review decision is not approval"] };
  const [source, transport, approved] = await Promise.all([
    input.runtime.inspectSource(input.sourceRoot),
    input.runtime.resolveTransportRef(input.sourceRoot, input.transportRef),
    input.runtime.inspectRevision(input.sourceRoot, input.approval.result.commitId, input.assignedBaseCommitId),
  ]);
  const reasons: string[] = [];
  if (source.changedPaths.length !== 0) reasons.push("source @ is not empty");
  if (source.parentCommitIds.length !== 1 || source.parentCommitIds[0] !== input.assignedBaseCommitId) reasons.push("source @- differs from assigned base");
  if (source.isConflicted) reasons.push("source @ has a structural conflict");
  if (transport.commitId !== input.approval.result.commitId || transport.changeId !== input.approval.facts.changeId) reasons.push("fetched transport ref is stale");
  reasons.push(...validateReviewerDecision(input.approval.result, approved, {
    commitId: input.approval.result.commitId, changeId: input.approval.facts.changeId,
    assignedBaseCommitId: input.assignedBaseCommitId, allowedTrackedPaths: input.allowedTrackedPaths,
  }).map((issue) => issue.message));
  if (reasons.length > 0) return { _tag: "blocked", reasons };

  await input.journal.append({ causationId: input.causationId, correlationId: input.approval.result.runId, payload: { _tag: "integration_started", commitId: input.approval.result.commitId, operationId: source.operationId } });
  await input.runtime.createEmptyWorkingCopy(input.sourceRoot, input.approval.result.commitId);
  const after = await input.runtime.inspectSource(input.sourceRoot);
  const afterReasons: string[] = [];
  if (after.parentCommitIds.length !== 1 || after.parentCommitIds[0] !== input.approval.result.commitId) afterReasons.push("new source @ is not directly parented by approved commit");
  if (after.changedPaths.length !== 0) afterReasons.push("new source @ is not empty");
  if (after.isConflicted) afterReasons.push("new source @ has a structural conflict");
  if (after.operationId === source.operationId) afterReasons.push("source integration did not create a Jujutsu operation");
  if (afterReasons.length > 0) return { _tag: "blocked", reasons: afterReasons };
  await input.journal.append({ causationId: input.causationId, correlationId: input.approval.result.runId, payload: { _tag: "integration_succeeded", commitId: input.approval.result.commitId, operationId: after.operationId } });
  return { _tag: "integrated", approvedCommitId: input.approval.result.commitId, beforeOperationId: source.operationId, afterOperationId: after.operationId };
};
