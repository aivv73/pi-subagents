import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SingleRunRegistry } from "../application/run-registry.js";
import { findPausedJournals, JsonlJournal, readJournal, repositoryStateDirectory } from "./jsonl-journal.js";

describe("JSONL journal adapter", () => {
  it("appends ordered fsynced records and reopens from the next sequence", async () => {
    const home = await mkdtemp(join(tmpdir(), "pi-subagents-journal-"));
    const stateDirectory = repositoryStateDirectory(home, "repository-1");
    const journal = await JsonlJournal.open(stateDirectory, "run-1");

    const createdPromise = journal.append({
      causationId: "command-1",
      correlationId: "run-1",
      payload: { _tag: "run_created", task: "update README" },
    }, new Date("2026-07-22T00:00:00.000Z"));
    const intentPromise = journal.append({
      causationId: "command-1",
      correlationId: "run-1",
      payload: { _tag: "external_intent", mutationId: "rift-create", operation: "create Rift" },
    }, new Date("2026-07-22T00:00:01.000Z"));
    const [created, intent] = await Promise.all([createdPromise, intentPromise]);

    expect([created.sequence, intent.sequence]).toEqual([1, 2]);
    expect((await readFile(journal.path, "utf8")).trim().split("\n")).toHaveLength(2);
    expect(await readJournal(journal.path)).toHaveLength(2);

    const reopened = await JsonlJournal.open(stateDirectory, "run-1");
    const outcome = await reopened.append({
      causationId: intent.eventId,
      correlationId: "run-1",
      payload: { _tag: "external_outcome", mutationId: "rift-create", outcome: "succeeded" },
    });
    expect(outcome.sequence).toBe(3);
  });

  it("reports interrupted journals as paused without resuming or deleting them", async () => {
    const home = await mkdtemp(join(tmpdir(), "pi-subagents-paused-"));
    const stateDirectory = repositoryStateDirectory(home, "repository-1");
    const journal = await JsonlJournal.open(stateDirectory, "run-1");
    await journal.append({
      causationId: "command-1",
      correlationId: "run-1",
      payload: { _tag: "run_created", task: "update README" },
    });
    await journal.append({
      causationId: "command-1",
      correlationId: "run-1",
      payload: { _tag: "worker_started" },
    });

    const paused = await findPausedJournals(stateDirectory);
    expect(paused).toMatchObject([
      {
        disposition: "paused",
        runId: "run-1",
        state: { status: "running" },
        manualCleanupGuidance: expect.stringContaining("not available"),
      },
    ]);
    expect(await readJournal(journal.path)).toHaveLength(2);
  });

  it("uses a project-specific safe state root and rejects traversal", () => {
    expect(repositoryStateDirectory("/home/alice", "repository-1")).toBe(
      "/home/alice/.pi/agent/state/pi-subagents/repository-1",
    );
    expect(() => repositoryStateDirectory("/home/alice", "../escape")).toThrow("path-safe");
  });
});

describe("single-run registry", () => {
  it("rejects a second active run and permits a run after release", () => {
    const registry = new SingleRunRegistry();
    expect(registry.claim("run-1")).toEqual({ _tag: "claimed" });
    expect(registry.claim("run-2")).toEqual({ _tag: "already_active", runId: "run-1" });
    registry.release("run-1");
    expect(registry.claim("run-2")).toEqual({ _tag: "claimed" });
  });
});
