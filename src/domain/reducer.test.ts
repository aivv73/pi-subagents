import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { reduce, replay, type RunState } from "./reducer.js";
import { decodeJournalEvent, decodeRunState, JournalDecodeError, type JournalEvent } from "./schema.js";

const eventFactory = (runId = "run-1") => {
  let sequence = 0;
  return (payload: unknown): JournalEvent =>
    decodeJournalEvent({
      schemaVersion: 1,
      runId,
      sequence: ++sequence,
      eventId: randomUUID(),
      timestamp: "2026-07-22T00:00:00.000Z",
      causationId: "command-1",
      correlationId: runId,
      payload,
    });
};

const successfulRevisionRun = (): readonly JournalEvent[] => {
  const event = eventFactory();
  return [
    event({ _tag: "run_created", task: "update README" }),
    event({ _tag: "external_intent", mutationId: "rift-create", operation: "create Rift" }),
    event({ _tag: "external_outcome", mutationId: "rift-create", outcome: "succeeded" }),
    event({ _tag: "worker_started" }),
    event({ _tag: "worker_result_validated", commitId: "commit-1" }),
    event({ _tag: "review_revision_requested", commitId: "commit-1", findings: "add a test" }),
    event({ _tag: "worker_revised", commitId: "commit-2" }),
    event({ _tag: "review_approved", commitId: "commit-2" }),
    event({ _tag: "integration_started", commitId: "commit-2" }),
    event({ _tag: "integration_succeeded", commitId: "commit-2" }),
    event({ _tag: "cleanup_succeeded" }),
  ];
};

describe("event-sourced single-run reducer", () => {
  it("derives a reviewed one-revision success deterministically", () => {
    const events = successfulRevisionRun();
    const first = replay(events);
    const second = events.reduce<RunState | undefined>((state, event) => reduce(state, event), undefined);

    expect(first).toMatchObject({
      status: "succeeded",
      taskStatus: "integrated",
      revisionRequests: 1,
      currentCommitId: "commit-2",
      pendingMutationIds: [],
      lastSequence: 11,
    });
    expect(second).toEqual(first);
    expect(decodeRunState(first)).toEqual(first);
  });

  it.each([
    ["blocked", [{ _tag: "worker_started" }, { _tag: "agent_blocked", role: "worker", diagnostic: "waiting" }]],
    ["failed", [{ _tag: "worker_started" }, { _tag: "run_failed", reason: "protocol failure" }]],
    ["cancelled", [{ _tag: "worker_started" }, { _tag: "cancellation_requested" }, { _tag: "run_cancelled" }]],
  ] as const)("derives %s terminal or attention state", (expectedStatus, suffix) => {
    const event = eventFactory();
    const state = replay([event({ _tag: "run_created", task: "task" }), ...suffix.map(event)]);
    expect(state.status).toBe(expectedStatus);
  });

  it("rejects a second reviewer rejection after the one permitted worker amendment", () => {
    const event = eventFactory();
    const events = [
      event({ _tag: "run_created", task: "task" }),
      event({ _tag: "worker_started" }),
      event({ _tag: "worker_result_validated", commitId: "commit-1" }),
      event({ _tag: "review_revision_requested", commitId: "commit-1", findings: "first finding" }),
      event({ _tag: "worker_revised", commitId: "commit-2" }),
    ];
    expect(() => replay([...events, event({ _tag: "review_revision_requested", commitId: "commit-2", findings: "second finding" })]))
      .toThrow("revision budget is exhausted");
  });

  it("keeps an integrated change successful when cleanup warns", () => {
    const events = successfulRevisionRun().slice(0, -1);
    const previous = events.at(-1)!;
    const warning = decodeJournalEvent({
      ...previous,
      sequence: previous.sequence + 1,
      eventId: randomUUID(),
      payload: { _tag: "cleanup_failed", reason: "Rift trash is busy" },
    });
    const state = replay([...events, warning]);
    expect(state).toMatchObject({
      status: "succeeded_with_cleanup_warning",
      taskStatus: "integrated",
      terminalReason: "Rift trash is busy",
    });
  });

  it("rejects non-contiguous records, unmatched outcomes, and post-terminal events", () => {
    const event = eventFactory();
    const created = event({ _tag: "run_created", task: "task" });
    const skipped = decodeJournalEvent({ ...event({ _tag: "worker_started" }), sequence: 3, eventId: randomUUID() });
    expect(() => replay([created, skipped])).toThrow("not contiguous");

    const event2 = eventFactory();
    expect(() => replay([
      event2({ _tag: "run_created", task: "task" }),
      event2({ _tag: "external_outcome", mutationId: "missing", outcome: "failed" }),
    ])).toThrow("no prior intent");

    const event3 = eventFactory();
    expect(() => replay([
      event3({ _tag: "run_created", task: "task" }),
      event3({ _tag: "run_failed", reason: "stop" }),
      event3({ _tag: "worker_started" }),
    ])).toThrow("after terminal");
  });
});

describe("journal event schema", () => {
  it("rejects unknown fields and unsupported payload tags", () => {
    const event = eventFactory()({ _tag: "run_created", task: "task" });
    expect(() => decodeJournalEvent({ ...event, extra: true })).toThrow(JournalDecodeError);
    expect(() => decodeJournalEvent({ ...event, payload: { _tag: "future_event" } })).toThrow(JournalDecodeError);
  });
});
