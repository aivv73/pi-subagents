import { describe, expect, it } from "vitest";

import { childEnvironment, childPiArguments } from "./child-runtime.js";

const config = {
  schemaVersion: 1,
  role: "worker" as const,
  root: "/workspace",
  allowedTrackedPaths: ["README.md"],
  resultPath: "/workspace/.pi-subagents/runs/run-1/tasks/task-1/attempts/attempt-1/output/worker-result.v1.json",
  envelope: {
    schemaVersion: 1,
    runId: "run-1",
    taskId: "task-1",
    attemptId: "attempt-1",
    role: "worker" as const,
    task: "task",
    root: "/workspace",
    allowedTrackedPaths: ["README.md"],
    assignedBaseCommitId: "base",
    outputRelativePath: "output/worker-result.v1.json",
  },
  maxReadBytes: 4096,
  maxOutputBytes: 4096,
};

describe("child Pi launch policy", () => {
  it("keeps only minimal runtime variables and never forwards credentials", () => {
    const environment = childEnvironment({
      PATH: "/bin",
      HOME: "/home/child",
      OPENAI_API_KEY: "secret",
      AWS_SECRET_ACCESS_KEY: "secret",
      SSH_AUTH_SOCK: "/tmp/agent",
      HTTPS_PROXY: "https://proxy",
    }, config);
    expect(environment).toMatchObject({ PATH: "/bin", HOME: "/home/child", PI_SUBAGENTS_GUARD_CONFIG: expect.any(String) });
    expect(environment).not.toHaveProperty("OPENAI_API_KEY");
    expect(environment).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(environment).not.toHaveProperty("SSH_AUTH_SOCK");
    expect(environment).not.toHaveProperty("HTTPS_PROXY");
  });

  it("disables built-ins and project discovery while explicitly loading only the guard extension", () => {
    expect(childPiArguments("/package/dist/child-extension.js")).toEqual(expect.arrayContaining([
      "--no-builtin-tools",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--no-approve",
      "--extension",
      "/package/dist/child-extension.js",
    ]));
  });
});
