import { describe, expect, it } from "vitest";

import { publishValidatedWorkerAttempt, WorkerPublicationError } from "./worker-publication.js";
import type { FetchedTransportRevision, GitTransport, TransportPublicationRequest } from "../ports/git-transport.js";
import type { RunJournal } from "../ports/journal.js";
import type { ValidatedWorkerAttempt, WorkerAttemptRuntime } from "../ports/worker-attempt.js";

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

const attempt: ValidatedWorkerAttempt = {
  _tag: "validated",
  attempt: {
    _tag: "running",
    snapshot: { id: "worker-1", root: "/worker" },
    agent: { name: "worker-1", paneId: "pane-1" },
    artifacts: {
      root: "/worker",
      directory: "/worker/.pi-subagents/attempt",
      inputPath: "/input",
      checksumPath: "/checksum",
      outputPath: "/output",
      evidenceDirectory: "/evidence",
      envelope: {
        schemaVersion: 1,
        runId: "run-1",
        taskId: "task-1",
        attemptId: "attempt-1",
        role: "worker",
        task: "update README",
        root: "/worker",
        allowedTrackedPaths: ["README.md"],
        assignedBaseCommitId: "base-commit",
        outputRelativePath: "output/worker-result.v1.json",
      },
    },
    copiedChange: { changeId: "copied-change", commitId: "copied-commit" },
    taskChange: { changeId: "task-change", commitId: "task-commit" },
  },
  result,
  facts,
};

const runtime = (currentFacts = facts): WorkerAttemptRuntime => ({
  readResult: async () => result,
  inspectWorkerRevision: async () => currentFacts,
} as WorkerAttemptRuntime);

const journal = () => {
  const drafts: Array<{ readonly payload: { readonly _tag: string } }> = [];
  const value: RunJournal = {
    path: "/journal",
    runId: "run-1",
    append: async (draft) => {
      drafts.push(draft);
      return { eventId: `event-${drafts.length}` } as never;
    },
  };
  return { value, drafts };
};

const request = { stateDirectory: "/state", coordinatorRoot: "/source", causationId: "command-1" };

describe("worker publication", () => {
  it("revalidates mutable facts, then durably brackets an exact transport effect", async () => {
    const { value: runJournal, drafts } = journal();
    let received: TransportPublicationRequest | undefined;
    const transport: GitTransport = {
      async publishAndFetch(value) {
        received = value;
        return {
          transportRef: value.revision.transportRef,
          remoteCommitId: value.revision.commitId,
          fetchedCommitId: value.revision.commitId,
          fetchedChangeId: value.revision.changeId,
        };
      },
    };

    await expect(publishValidatedWorkerAttempt(attempt, request, runtime(), transport, runJournal)).resolves.toMatchObject({
      fetchedCommitId: "task-commit",
    });
    expect(received).toMatchObject({ revision: { transportRef: "pi-subagents/run-1/task-1/attempt-1", commitId: "task-commit" } });
    expect(drafts.map((draft) => draft.payload._tag)).toEqual(["external_intent", "external_outcome"]);
  });

  it("does not create a transport intent when worker facts have become stale or out of scope", async () => {
    const { value: runJournal, drafts } = journal();
    const transport: GitTransport = { publishAndFetch: async () => { throw new Error("must not publish"); } };
    await expect(publishValidatedWorkerAttempt(
      attempt,
      request,
      runtime({ ...facts, changedPaths: ["outside.txt"] }),
      transport,
      runJournal,
    )).rejects.toBeInstanceOf(WorkerPublicationError);
    expect(drafts).toEqual([]);
  });

  it("records a failed outcome when fetched identity no longer agrees", async () => {
    const { value: runJournal, drafts } = journal();
    const transport: GitTransport = {
      publishAndFetch: async (value): Promise<FetchedTransportRevision> => ({
        transportRef: value.revision.transportRef,
        remoteCommitId: value.revision.commitId,
        fetchedCommitId: value.revision.commitId,
        fetchedChangeId: "moved-change",
      }),
    };
    await expect(publishValidatedWorkerAttempt(attempt, request, runtime(), transport, runJournal)).rejects.toBeInstanceOf(WorkerPublicationError);
    expect(drafts.map((draft) => draft.payload._tag)).toEqual(["external_intent", "external_outcome"]);
    expect(drafts.at(-1)?.payload).toMatchObject({ outcome: "failed" });
  });
});
