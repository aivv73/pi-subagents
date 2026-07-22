import type { RevisionIdentity, WorkerRevisionFacts } from "../domain/worker-attempt.js";

export interface SourceIntegrationFacts extends RevisionIdentity {
  readonly parentCommitIds: readonly string[];
  readonly changedPaths: readonly string[];
  readonly isConflicted: boolean;
  readonly operationId: string;
}

export interface IntegrationRuntime {
  inspectSource(root: string): Promise<SourceIntegrationFacts>;
  inspectRevision(root: string, revision: string, assignedBaseCommitId: string): Promise<WorkerRevisionFacts>;
  resolveTransportRef(root: string, transportRef: string): Promise<RevisionIdentity>;
  createEmptyWorkingCopy(root: string, approvedCommitId: string): Promise<void>;
}
