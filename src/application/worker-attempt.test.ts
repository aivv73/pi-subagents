import { describe, expect, it } from "vitest";

import { startWorkerAttempt, superviseWorkerAttempt } from "./worker-attempt.js";
import { validateWorkerResult } from "../domain/worker-attempt.js";
import type { WorkerAttemptRequest, WorkerAttemptRuntime } from "../ports/worker-attempt.js";

const envelope = {
  schemaVersion: 1 as const,
  runId: "run-1",
  taskId: "task-1",
  attemptId: "attempt-1",
  role: "worker" as const,
  task: "Implement exactly this user command",
  root: "/rift/worker-1",
  allowedTrackedPaths: ["README.md"],
  assignedBaseCommitId: "base-commit",
  outputRelativePath: "output/worker-result.v1.json",
};

const artifacts = {
  root: "/rift/worker-1",
  directory: "/rift/worker-1/.pi-subagents/runs/run-1/tasks/task-1/attempts/attempt-1",
  inputPath: "/input",
  checksumPath: "/input.sha256",
  outputPath: "/rift/worker-1/.pi-subagents/runs/run-1/tasks/task-1/attempts/attempt-1/output/worker-result.v1.json",
  evidenceDirectory: "/evidence",
  envelope,
};

const result = {
  _tag: "worker" as const,
  schemaVersion: 1 as const,
  runId: "run-1",
  taskId: "task-1",
  attemptId: "attempt-1",
  changeId: "task-change",
  commitId: "task-commit",
  changedPaths: ["README.md"],
};

const facts = {
  changeId: "task-change",
  commitId: "task-commit",
  assignedBaseCommitId: "base-commit",
  parentCommitIds: ["base-commit"],
  revisionCommitIds: ["task-commit"],
  isDescendantOfAssignedBase: true,
  isConflicted: false,
  description: "Update README",
  changedPaths: ["README.md"],
  trackedArtifactPaths: [],
};

const request: WorkerAttemptRequest = {
  runId: "run-1",
  taskId: "task-1",
  attemptId: "attempt-1",
  userCommand: "Implement exactly this user command",
  sourceRoot: "/source",
  snapshotDestination: "/rift/worker-1",
  snapshotName: "worker-1",
  agentName: "worker-1",
  assignedBaseCommitId: "base-commit",
  allowedTrackedPaths: ["README.md"],
  childExtensionPath: "/package/dist/child-extension.js",
  builtInPromptPath: "/package/prompts/worker.md",
  piExecutable: "pi",
  parentModel: "openai/gpt-5.6",
  parentEnvironment: { PATH: "/bin", HOME: "/home/child", OPENAI_API_KEY: "must-not-forward" },
};

const runtime = (observations: readonly ("ready" | "settled" | "blocked")[] = ["ready", "settled"]) => {
  const calls: string[] = [];
  let nextObservation = 0;
  const value: WorkerAttemptRuntime = {
    async createExactSnapshot() {
      calls.push("snapshot");
      return { id: "worker-1", root: "/rift/worker-1" };
    },
    async currentRevision() {
      calls.push("copied");
      return { changeId: "copied-change", commitId: "copied-commit" };
    },
    async createFreshTaskChange() {
      calls.push("fresh");
      return { changeId: "task-change", commitId: "task-commit" };
    },
    async createArtifacts(_root, receivedEnvelope) {
      calls.push(`artifacts:${receivedEnvelope.task}`);
      return artifacts;
    },
    async readResult() {
      calls.push("result");
      return result;
    },
    async inspectWorkerRevision() {
      calls.push("facts");
      return facts;
    },
    async startAgent(start) {
      calls.push(`start:${start.argv.join(" ")}`);
      expect(start.environment).not.toHaveProperty("OPENAI_API_KEY");
      return { name: "worker-1", paneId: "pane-1" };
    },
    async waitForObservation(_agent, phase) {
      calls.push(`wait:${phase}`);
      return observations[nextObservation++]!;
    },
    async sendPrompt(_agent, prompt) {
      calls.push(`prompt:${prompt}`);
    },
  };
  return { value, calls };
};

describe("worker attempt supervisor", () => {
  it("creates an exact isolated task, waits for readiness, and sends the full user command", async () => {
    const { value, calls } = runtime();
    const started = await startWorkerAttempt(request, value);
    expect(started).toMatchObject({ _tag: "running", copiedChange: { changeId: "copied-change" }, taskChange: { changeId: "task-change" } });
    expect(calls).toEqual(expect.arrayContaining([
      "snapshot",
      "copied",
      "fresh",
      "artifacts:Implement exactly this user command",
      "wait:startup",
      "prompt:Implement exactly this user command",
    ]));
    expect(calls.find((call) => call.startsWith("start:"))).toContain("--model openai/gpt-5.6");
    expect(calls.find((call) => call.startsWith("start:"))).toContain("--no-builtin-tools");
  });

  it("retains a blocked worker and never sends its prompt", async () => {
    const { value, calls } = runtime(["blocked"]);
    const started = await startWorkerAttempt(request, value);
    expect(started).toMatchObject({ _tag: "blocked", agent: { paneId: "pane-1" } });
    expect(calls).not.toContain(`prompt:${request.userCommand}`);
  });

  it("requires a result artifact and repository facts after settlement", async () => {
    const { value } = runtime();
    const started = await startWorkerAttempt(request, value);
    if (started._tag !== "running") throw new Error("expected running worker");
    const outcome = await superviseWorkerAttempt(started, request.assignedBaseCommitId, request.allowedTrackedPaths, value);
    expect(outcome).toMatchObject({ _tag: "validated", result: { commitId: "task-commit" } });
  });

  it("treats blocked settlement and invalid repository shape as retained failures", async () => {
    const blockedRuntime = runtime(["ready", "blocked"]);
    const started = await startWorkerAttempt(request, blockedRuntime.value);
    if (started._tag !== "running") throw new Error("expected running worker");
    expect(await superviseWorkerAttempt(started, request.assignedBaseCommitId, request.allowedTrackedPaths, blockedRuntime.value)).toMatchObject({
      _tag: "blocked",
      agent: { paneId: "pane-1" },
    });

    const invalidRuntime = runtime();
    invalidRuntime.value.inspectWorkerRevision = async () => ({ ...facts, changedPaths: ["secret.txt"] });
    const startedInvalid = await startWorkerAttempt(request, invalidRuntime.value);
    if (startedInvalid._tag !== "running") throw new Error("expected running worker");
    expect(await superviseWorkerAttempt(startedInvalid, request.assignedBaseCommitId, request.allowedTrackedPaths, invalidRuntime.value)).toMatchObject({
      _tag: "invalid_result",
      issues: [expect.objectContaining({ code: "out_of_scope_path" })],
    });
  });
});

describe("worker result validation", () => {
  it("rejects copied changes, stacks, merges, empty/undescribed/conflicted changes, and artifacts", () => {
    const issues = validateWorkerResult(result, {
      ...facts,
      changeId: "copied-change",
      parentCommitIds: ["base-commit", "other-parent"],
      revisionCommitIds: ["first", "second"],
      changedPaths: [],
      description: "",
      isConflicted: true,
      trackedArtifactPaths: [".pi-subagents/runs/run-1/output.json"],
    }, {
      copiedChangeId: "copied-change",
      taskChangeId: "copied-change",
      assignedBaseCommitId: "base-commit",
      allowedTrackedPaths: ["README.md"],
    });
    expect(issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "identity_mismatch", "copied_change", "stack_or_merge", "empty_change", "missing_description", "tracked_artifact", "conflicted_change",
    ]));
  });
});
