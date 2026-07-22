import { describe, expect, it } from "vitest";

import { assertExactWorkerRevision, attemptTransportRef, TransportIdentityError } from "./git-transport.js";

describe("attempt transport identity", () => {
  it("derives the sole coordinator-owned ref namespace from path-safe attempt IDs", () => {
    expect(attemptTransportRef({ runId: "run-1", taskId: "task.1", attemptId: "attempt_1" }))
      .toBe("pi-subagents/run-1/task.1/attempt_1");
    expect(() => attemptTransportRef({ runId: "../upstream", taskId: "task", attemptId: "attempt" }))
      .toThrow(TransportIdentityError);
  });

  it("rejects a caller-supplied ref outside that exact namespace", () => {
    expect(() => assertExactWorkerRevision({
      workerRoot: "/worker",
      assignedBaseCommitId: "base",
      changeId: "change",
      commitId: "commit",
      transportRef: "refs/heads/main",
    })).toThrow(TransportIdentityError);
  });
});
