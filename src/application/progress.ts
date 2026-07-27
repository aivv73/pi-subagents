/** Semantic coordinator progress only; Herdr process states are deliberately not phases here. */
export type SemanticPhase =
  | "preflight" | "worker_running" | "worker_validating" | "reviewing" | "revision_requested"
  | "integrating" | "cleaning" | "cancelling" | "blocked" | "cancelled" | "failed" | "succeeded" | "succeeded_with_cleanup_warning";

export interface SemanticProgress {
  readonly phase: SemanticPhase;
  readonly detail?: string;
  readonly integratedCommitId?: string;
  readonly retainedResources?: readonly string[];
}

const labels: Readonly<Record<SemanticPhase, string>> = {
  preflight: "Preflight", worker_running: "Worker running", worker_validating: "Validating worker result",
  reviewing: "Reviewing exact revision", revision_requested: "Worker revision requested", integrating: "Integrating approved revision",
  cleaning: "Cleaning verified resources", cancelling: "Cancellation requested", blocked: "Blocked — inspect retained resources", cancelled: "Cancelled — resources retained",
  failed: "Failed — resources retained", succeeded: "Succeeded", succeeded_with_cleanup_warning: "Succeeded — cleanup warning",
};

export const progressWidget = (progress: SemanticProgress): string[] => {
  const lines = [`Subagents: ${labels[progress.phase]}`];
  if (progress.integratedCommitId !== undefined) lines.push(`Integrated: ${progress.integratedCommitId}`);
  if (progress.retainedResources !== undefined && progress.retainedResources.length > 0) lines.push(`Retained: ${progress.retainedResources.join(", ")}`);
  if (progress.detail !== undefined) lines.push(progress.detail);
  return lines;
};

export const progressNotification = (progress: SemanticProgress): { readonly type: "info" | "warning" | "error"; readonly message: string } | undefined => {
  switch (progress.phase) {
    case "blocked": case "failed": return { type: "error", message: progressWidget(progress).join(" — ") };
    case "cancelled": case "succeeded_with_cleanup_warning": return { type: "warning", message: progressWidget(progress).join(" — ") };
    case "succeeded": return { type: "info", message: progressWidget(progress).join(" — ") };
    default: return undefined;
  }
};
