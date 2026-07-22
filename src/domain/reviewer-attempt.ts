import type { ResultArtifact } from "./artifact-schema.js";
import type { WorkerRevisionFacts } from "./worker-attempt.js";

export interface ReviewTarget {
  readonly commitId: string;
  readonly changeId: string;
  readonly assignedBaseCommitId: string;
  readonly allowedTrackedPaths: readonly string[];
}

export interface ReviewValidationIssue {
  readonly code: "wrong_role" | "identity_mismatch" | "wrong_base" | "invalid_revision" | "out_of_scope_path" | "conflicted_change" | "missing_findings";
  readonly message: string;
}

/** Validates the decision binding and coordinator-observable review target facts. */
export const validateReviewerDecision = (
  result: ResultArtifact,
  facts: WorkerRevisionFacts,
  target: ReviewTarget,
): readonly ReviewValidationIssue[] => {
  const issues: ReviewValidationIssue[] = [];
  if (result._tag !== "reviewer") return [{ code: "wrong_role", message: "review attempt received a non-reviewer artifact" }];
  if (result.commitId !== target.commitId || facts.commitId !== target.commitId || facts.changeId !== target.changeId) {
    issues.push({ code: "identity_mismatch", message: "review decision and target revision identities must agree exactly" });
  }
  if (result.assignedBaseCommitId !== target.assignedBaseCommitId || facts.assignedBaseCommitId !== target.assignedBaseCommitId) {
    issues.push({ code: "wrong_base", message: "review decision is bound to another assigned base" });
  }
  if (!facts.isDescendantOfAssignedBase || facts.parentCommitIds.length !== 1 || facts.parentCommitIds[0] !== target.assignedBaseCommitId || facts.revisionCommitIds.length !== 1 || facts.description.trim() === "") {
    issues.push({ code: "invalid_revision", message: "review target must remain one described non-merge change from assigned base" });
  }
  if (facts.isConflicted) issues.push({ code: "conflicted_change", message: "review target has a structural Jujutsu conflict" });
  const allowed = new Set(target.allowedTrackedPaths);
  for (const path of facts.changedPaths) if (!allowed.has(path)) issues.push({ code: "out_of_scope_path", message: `review target changed undeclared path: ${path}` });
  if (result.decision === "revision_requested" && result.findings.trim() === "") {
    issues.push({ code: "missing_findings", message: "a revision request requires actionable findings" });
  }
  return issues;
};
