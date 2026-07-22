import { childEnvironment, childPiArguments } from "./child-runtime.js";
import { validateWorkerResult } from "../domain/worker-attempt.js";
import type {
  BlockedWorkerAttempt,
  RunningWorkerAttempt,
  StartedWorkerAttempt,
  SupervisedWorkerAttempt,
  WorkerAttemptRequest,
  WorkerAttemptRuntime,
} from "../ports/worker-attempt.js";

const blocked = (
  running: Pick<RunningWorkerAttempt, "snapshot" | "agent" | "artifacts">,
  reason: string,
): BlockedWorkerAttempt => ({ ...running, _tag: "blocked", reason });

/** Starts only one worker. Herdr observation is liveness information, never semantic completion. */
export const startWorkerAttempt = async (
  request: WorkerAttemptRequest,
  runtime: WorkerAttemptRuntime,
): Promise<StartedWorkerAttempt> => {
  const snapshot = await runtime.createExactSnapshot({
    sourceRoot: request.sourceRoot,
    destination: request.snapshotDestination,
    name: request.snapshotName,
  });
  const copiedChange = await runtime.currentRevision(snapshot.root);
  const taskChange = await runtime.createFreshTaskChange(snapshot.root, request.assignedBaseCommitId);
  if (taskChange.changeId === copiedChange.changeId) throw new Error("fresh worker task change reused the copied change ID");

  const envelope = {
    schemaVersion: 1 as const,
    runId: request.runId,
    taskId: request.taskId,
    attemptId: request.attemptId,
    role: "worker" as const,
    task: request.userCommand,
    root: snapshot.root,
    allowedTrackedPaths: [...request.allowedTrackedPaths],
    assignedBaseCommitId: request.assignedBaseCommitId,
    outputRelativePath: "output/worker-result.v1.json",
  };
  const artifacts = await runtime.createArtifacts(snapshot.root, envelope);
  const guardConfig = {
    schemaVersion: 1 as const,
    role: "worker" as const,
    root: snapshot.root,
    allowedTrackedPaths: [...request.allowedTrackedPaths],
    resultPath: artifacts.outputPath,
    envelope,
    reviewedCommitId: undefined,
    reviewedBaseCommitId: undefined,
    maxReadBytes: 256 * 1024,
    maxOutputBytes: 64 * 1024,
  };
  const argv = [
    request.piExecutable,
    "--model",
    request.parentModel,
    "--append-system-prompt",
    request.builtInPromptPath,
    ...childPiArguments(request.childExtensionPath),
  ];
  const agent = await runtime.startAgent({
    name: request.agentName,
    cwd: snapshot.root,
    argv,
    environment: childEnvironment(request.parentEnvironment, guardConfig),
  });
  const startup = await runtime.waitForObservation(agent, "startup");
  if (startup === "blocked") return blocked({ snapshot, agent, artifacts }, "worker blocked before prompt submission");
  if (startup !== "ready") throw new Error("worker did not reach an interactive ready state");

  // The full user command is both task text and acceptance guidance; no decomposer is involved.
  await runtime.sendPrompt(agent, request.userCommand);
  return { _tag: "running", snapshot, agent, artifacts, copiedChange, taskChange };
};

/** Converts a Herdr settlement into an authoritative result only after artifact and repository validation. */
export const superviseWorkerAttempt = async (
  attempt: RunningWorkerAttempt,
  assignedBaseCommitId: string,
  allowedTrackedPaths: readonly string[],
  runtime: WorkerAttemptRuntime,
): Promise<SupervisedWorkerAttempt> => {
  const observation = await runtime.waitForObservation(attempt.agent, "settlement");
  if (observation === "blocked") return blocked(attempt, "worker blocked while executing");
  if (observation !== "settled") throw new Error("worker did not settle");

  const [result, facts] = await Promise.all([
    runtime.readResult(attempt.artifacts),
    runtime.inspectWorkerRevision(attempt.snapshot.root, assignedBaseCommitId),
  ]);
  const issues = validateWorkerResult(result, facts, {
    copiedChangeId: attempt.copiedChange.changeId,
    taskChangeId: attempt.taskChange.changeId,
    assignedBaseCommitId,
    allowedTrackedPaths,
  });
  if (issues.length > 0) return { _tag: "invalid_result", attempt, issues };
  return { _tag: "validated", attempt, result, facts };
};
