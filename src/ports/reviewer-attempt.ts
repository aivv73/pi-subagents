import type { AttemptEnvelope, ResultArtifact } from "../domain/artifact-schema.js";
import type { ReviewValidationIssue } from "../domain/reviewer-attempt.js";
import type { RevisionIdentity, WorkerRevisionFacts } from "../domain/worker-attempt.js";
import type { AttemptArtifacts } from "./artifacts.js";
import type { HerdrAgent, HerdrObservation, RiftSnapshot } from "./worker-attempt.js";

export interface ReviewerAttemptRuntime {
  createExactSnapshot(request: { readonly sourceRoot: string; readonly destination: string; readonly name: string }): Promise<RiftSnapshot>;
  currentRevision(root: string): Promise<RevisionIdentity>;
  inspectRevision(root: string, revision: string, assignedBaseCommitId: string): Promise<WorkerRevisionFacts>;
  resolveTransportRef(root: string, transportRef: string): Promise<RevisionIdentity>;
  createArtifacts(root: string, envelope: AttemptEnvelope): Promise<AttemptArtifacts>;
  readResult(artifacts: AttemptArtifacts): Promise<ResultArtifact>;
  startAgent(request: { readonly name: string; readonly cwd: string; readonly argv: readonly string[]; readonly environment: NodeJS.ProcessEnv }): Promise<HerdrAgent>;
  waitForObservation(agent: HerdrAgent, phase: "startup" | "settlement"): Promise<HerdrObservation>;
  sendPrompt(agent: HerdrAgent, prompt: string): Promise<void>;
}

export interface ReviewerAttemptRequest {
  readonly runId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly userCommand: string;
  readonly coordinatorRoot: string;
  readonly snapshotDestination: string;
  readonly snapshotName: string;
  readonly agentName: string;
  readonly transportRef: string;
  readonly reviewedCommitId: string;
  readonly reviewedChangeId: string;
  readonly assignedBaseCommitId: string;
  readonly allowedTrackedPaths: readonly string[];
  readonly childExtensionPath: string;
  readonly builtInPromptPath: string;
  readonly piExecutable: string;
  readonly parentModel: string;
  readonly parentEnvironment: NodeJS.ProcessEnv;
}

export interface RunningReviewerAttempt {
  readonly _tag: "running";
  readonly snapshot: RiftSnapshot;
  readonly agent: HerdrAgent;
  readonly artifacts: AttemptArtifacts;
  readonly snapshotRevision: RevisionIdentity;
}
export interface BlockedReviewerAttempt {
  readonly _tag: "blocked";
  readonly snapshot: RiftSnapshot;
  readonly agent: HerdrAgent;
  readonly artifacts: AttemptArtifacts;
  readonly reason: string;
}
export interface InvalidReviewerAttempt {
  readonly _tag: "invalid_result";
  readonly attempt: RunningReviewerAttempt;
  readonly issues: readonly ReviewValidationIssue[];
}
export interface ReviewedDecision {
  readonly _tag: "reviewed";
  readonly attempt: RunningReviewerAttempt;
  readonly result: Extract<ResultArtifact, { readonly _tag: "reviewer" }>;
  readonly facts: WorkerRevisionFacts;
}
export type StartedReviewerAttempt = RunningReviewerAttempt | BlockedReviewerAttempt;
export type SupervisedReviewerAttempt = BlockedReviewerAttempt | InvalidReviewerAttempt | ReviewedDecision;
