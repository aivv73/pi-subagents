import type { DirectRunDisposition } from "./direct-run-supervisor.js";
import type { SemanticProgress } from "./progress.js";

export interface TerminalRunSummary {
  readonly runId: string;
  readonly disposition: DirectRunDisposition["_tag"];
  readonly integratedCommitId?: string;
  readonly retainedResourceIds: readonly string[];
}

const safeIdentity = (value: string): string => /^[A-Za-z0-9._/-]{1,256}$/.test(value) ? value : "[redacted]";

const retainedIds = (disposition: Extract<DirectRunDisposition, { readonly retained: unknown }>): readonly string[] => [
  ...disposition.retained.agents.flatMap((agent) => [`agent:${safeIdentity(agent.name)}`, `pane:${safeIdentity(agent.paneId)}`]),
  ...disposition.retained.rifts.map((rift) => `rift:${safeIdentity(rift.id)}`),
  ...(disposition.retained.transportRef === undefined ? [] : [`ref:${safeIdentity(disposition.retained.transportRef)}`]),
];

export const terminalSummary = (runId: string, disposition: DirectRunDisposition): TerminalRunSummary => {
  switch (disposition._tag) {
    case "succeeded": return { runId: safeIdentity(runId), disposition: disposition._tag, integratedCommitId: safeIdentity(disposition.approvedCommitId), retainedResourceIds: [] };
    case "succeeded_with_cleanup_warning": return { runId: safeIdentity(runId), disposition: disposition._tag, integratedCommitId: safeIdentity(disposition.approvedCommitId), retainedResourceIds: [] };
    default: return { runId: safeIdentity(runId), disposition: disposition._tag, retainedResourceIds: retainedIds(disposition) };
  }
};

export const terminalProgress = (summary: TerminalRunSummary, detail?: string): SemanticProgress => ({
  phase: summary.disposition,
  integratedCommitId: summary.integratedCommitId,
  retainedResources: summary.retainedResourceIds,
  detail,
});
