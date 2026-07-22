import type { ResultArtifact } from "./artifact-schema.js";

export interface RevisionIdentity {
  readonly changeId: string;
  readonly commitId: string;
}

export interface WorkerRevisionFacts extends RevisionIdentity {
  readonly assignedBaseCommitId: string;
  readonly parentCommitIds: readonly string[];
  readonly revisionCommitIds: readonly string[];
  readonly isDescendantOfAssignedBase: boolean;
  readonly isConflicted: boolean;
  readonly description: string;
  readonly changedPaths: readonly string[];
  readonly trackedArtifactPaths: readonly string[];
}

export interface WorkerValidationContext {
  readonly copiedChangeId: string;
  readonly taskChangeId: string;
  readonly assignedBaseCommitId: string;
  readonly allowedTrackedPaths: readonly string[];
}

export interface WorkerValidationIssue {
  readonly code:
    | "wrong_role"
    | "identity_mismatch"
    | "copied_change"
    | "wrong_base"
    | "not_descendant"
    | "stack_or_merge"
    | "empty_change"
    | "missing_description"
    | "out_of_scope_path"
    | "tracked_artifact"
    | "conflicted_change";
  readonly message: string;
}

export const validateWorkerResult = (
  result: ResultArtifact,
  facts: WorkerRevisionFacts,
  context: WorkerValidationContext,
): readonly WorkerValidationIssue[] => {
  const issues: WorkerValidationIssue[] = [];
  if (result._tag !== "worker") {
    issues.push({ code: "wrong_role", message: "worker attempt received a non-worker result artifact" });
    return issues;
  }
  if (result.changeId !== facts.changeId || result.commitId !== facts.commitId || facts.changeId !== context.taskChangeId) {
    issues.push({ code: "identity_mismatch", message: "result, task change, and repository identities must agree exactly" });
  }
  if (facts.changeId === context.copiedChangeId) {
    issues.push({ code: "copied_change", message: "worker reported the copied snapshot working-copy change" });
  }
  if (facts.assignedBaseCommitId !== context.assignedBaseCommitId) {
    issues.push({ code: "wrong_base", message: "worker change is bound to another assigned base" });
  }
  if (!facts.isDescendantOfAssignedBase) {
    issues.push({ code: "not_descendant", message: "worker change is not descended from the assigned base" });
  }
  if (facts.parentCommitIds.length !== 1 || facts.parentCommitIds[0] !== context.assignedBaseCommitId || facts.revisionCommitIds.length !== 1) {
    issues.push({ code: "stack_or_merge", message: "worker must produce exactly one non-merge change from the assigned base" });
  }
  if (facts.changedPaths.length === 0) {
    issues.push({ code: "empty_change", message: "worker change must be non-empty" });
  }
  if (facts.description.trim().length === 0) {
    issues.push({ code: "missing_description", message: "worker change must have a description" });
  }
  const allowed = new Set(context.allowedTrackedPaths);
  for (const path of facts.changedPaths) {
    if (!allowed.has(path)) issues.push({ code: "out_of_scope_path", message: `worker changed undeclared path: ${path}` });
  }
  for (const path of facts.trackedArtifactPaths) {
    if (path === ".pi-subagents" || path.startsWith(".pi-subagents/")) {
      issues.push({ code: "tracked_artifact", message: `worker tracked coordinator artifact: ${path}` });
    }
  }
  if (facts.isConflicted) {
    issues.push({ code: "conflicted_change", message: "worker change has a structural Jujutsu conflict" });
  }
  return issues;
};
