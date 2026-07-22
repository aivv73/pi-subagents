const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class TransportIdentityError extends Error {
  override readonly name = "TransportIdentityError";
}

const assertIdentifier = (name: string, value: string): void => {
  if (!identifierPattern.test(value)) throw new TransportIdentityError(`${name} must be a path-safe identifier`);
};

/** The only mutable namespace exposed by the coordinator-local transport. */
export const attemptTransportRef = (identity: {
  readonly runId: string;
  readonly taskId: string;
  readonly attemptId: string;
}): string => {
  assertIdentifier("run ID", identity.runId);
  assertIdentifier("task ID", identity.taskId);
  assertIdentifier("attempt ID", identity.attemptId);
  return `pi-subagents/${identity.runId}/${identity.taskId}/${identity.attemptId}`;
};

export interface ExactWorkerRevision {
  readonly workerRoot: string;
  readonly assignedBaseCommitId: string;
  readonly changeId: string;
  readonly commitId: string;
  readonly transportRef: string;
}

export const assertExactWorkerRevision = (revision: ExactWorkerRevision): void => {
  if (revision.workerRoot.length === 0 || revision.assignedBaseCommitId.length === 0) {
    throw new TransportIdentityError("worker root and assigned base must be present");
  }
  if (revision.changeId.length === 0 || revision.commitId.length === 0) {
    throw new TransportIdentityError("worker change and commit identities must be present");
  }
  const prefix = "pi-subagents/";
  if (!revision.transportRef.startsWith(prefix) || revision.transportRef.slice(prefix.length).split("/").length !== 3) {
    throw new TransportIdentityError("transport ref is outside the attempt namespace");
  }
  for (const segment of revision.transportRef.slice(prefix.length).split("/")) assertIdentifier("transport ref segment", segment);
};
