import type { ExactWorkerRevision } from "../domain/git-transport.js";

export interface TransportPublicationRequest {
  readonly stateDirectory: string;
  readonly coordinatorRoot: string;
  readonly revision: ExactWorkerRevision;
}

export interface FetchedTransportRevision {
  readonly transportRef: string;
  readonly remoteCommitId: string;
  readonly fetchedCommitId: string;
  readonly fetchedChangeId: string;
}

/** Coordinator-only mutation boundary for the local bare Git transport. */
export interface GitTransport {
  publishAndFetch(request: TransportPublicationRequest): Promise<FetchedTransportRevision>;
}
