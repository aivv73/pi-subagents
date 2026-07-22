import type { AttemptEnvelope } from "../domain/artifact-schema.js";
import type { RevisionIdentity, WorkerRevisionFacts } from "../domain/worker-attempt.js";
import type { AttemptArtifacts } from "./artifacts.js";

export interface RiftSnapshot {
  readonly id: string;
  readonly root: string;
}

export interface HerdrAgent {
  readonly name: string;
  readonly paneId: string;
}

export type HerdrObservation = "ready" | "settled" | "blocked";

export interface WorkerAttemptRuntime {
  createExactSnapshot(request: {
    readonly sourceRoot: string;
    readonly destination: string;
    readonly name: string;
  }): Promise<RiftSnapshot>;
  currentRevision(root: string): Promise<RevisionIdentity>;
  createFreshTaskChange(root: string, assignedBaseCommitId: string): Promise<RevisionIdentity>;
  createArtifacts(root: string, envelope: AttemptEnvelope): Promise<AttemptArtifacts>;
  readResult(artifacts: AttemptArtifacts): Promise<import("../domain/artifact-schema.js").ResultArtifact>;
  inspectWorkerRevision(root: string, assignedBaseCommitId: string): Promise<WorkerRevisionFacts>;
  startAgent(request: {
    readonly name: string;
    readonly cwd: string;
    readonly argv: readonly string[];
    readonly environment: NodeJS.ProcessEnv;
  }): Promise<HerdrAgent>;
  waitForObservation(agent: HerdrAgent, phase: "startup" | "settlement"): Promise<HerdrObservation>;
  sendPrompt(agent: HerdrAgent, prompt: string): Promise<void>;
}

export interface WorkerAttemptRequest {
  readonly runId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly userCommand: string;
  readonly sourceRoot: string;
  readonly snapshotDestination: string;
  readonly snapshotName: string;
  readonly agentName: string;
  readonly assignedBaseCommitId: string;
  readonly allowedTrackedPaths: readonly string[];
  readonly childExtensionPath: string;
  readonly builtInPromptPath: string;
  readonly piExecutable: string;
  readonly parentModel: string;
  readonly parentEnvironment: NodeJS.ProcessEnv;
}

export interface RunningWorkerAttempt {
  readonly _tag: "running";
  readonly snapshot: RiftSnapshot;
  readonly agent: HerdrAgent;
  readonly artifacts: AttemptArtifacts;
  readonly copiedChange: RevisionIdentity;
  readonly taskChange: RevisionIdentity;
}

export interface BlockedWorkerAttempt {
  readonly _tag: "blocked";
  readonly snapshot: RiftSnapshot;
  readonly agent: HerdrAgent;
  readonly artifacts: AttemptArtifacts;
  readonly reason: string;
}

export interface InvalidWorkerAttempt {
  readonly _tag: "invalid_result";
  readonly attempt: RunningWorkerAttempt;
  readonly issues: readonly import("../domain/worker-attempt.js").WorkerValidationIssue[];
}

export interface ValidatedWorkerAttempt {
  readonly _tag: "validated";
  readonly attempt: RunningWorkerAttempt;
  readonly result: import("../domain/artifact-schema.js").ResultArtifact;
  readonly facts: WorkerRevisionFacts;
}

export type StartedWorkerAttempt = RunningWorkerAttempt | BlockedWorkerAttempt;
export type SupervisedWorkerAttempt = BlockedWorkerAttempt | InvalidWorkerAttempt | ValidatedWorkerAttempt;
