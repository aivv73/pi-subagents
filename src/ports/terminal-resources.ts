export interface RetainedAgent {
  readonly name: string;
  readonly paneId: string;
}
export interface RetainedRift {
  readonly id: string;
  readonly root: string;
}
export interface TerminalResources {
  readonly sourceRoot: string;
  readonly agents: readonly RetainedAgent[];
  readonly rifts: readonly RetainedRift[];
  readonly stateDirectory: string;
  readonly transportRef: string | undefined;
  readonly transportCommitId: string | undefined;
}

export interface TerminalResourceRuntime {
  requestCooperativeStop(agent: RetainedAgent): Promise<void>;
  waitForStop(agent: RetainedAgent, timeoutMs: number): Promise<boolean>;
  sendInterrupt(agent: RetainedAgent): Promise<void>;
  deleteTransportRef(stateDirectory: string, ref: string, expectedCommitId: string): Promise<void>;
  closePane(agent: RetainedAgent): Promise<void>;
  removeRift(rift: RetainedRift, sourceRoot: string): Promise<void>;
  garbageCollectRifts(): Promise<void>;
}
