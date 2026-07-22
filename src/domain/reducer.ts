import type { JournalEvent } from "./schema.js";

export type RunStatus =
  | "created"
  | "running"
  | "awaiting_review"
  | "revision_requested"
  | "approved"
  | "integrating"
  | "cleaning"
  | "blocked"
  | "cancelling"
  | "succeeded"
  | "succeeded_with_cleanup_warning"
  | "failed"
  | "cancelled";

export type TaskStatus =
  | "pending"
  | "running"
  | "awaiting_review"
  | "revision_requested"
  | "approved"
  | "integrated"
  | "blocked"
  | "cancelling"
  | "failed"
  | "cancelled";

export type TerminalStatus = "succeeded" | "succeeded_with_cleanup_warning" | "failed" | "cancelled";

export interface RunState {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly task: string;
  readonly status: RunStatus;
  readonly taskStatus: TaskStatus;
  readonly revisionRequests: number;
  readonly currentCommitId: string | undefined;
  readonly terminalReason: string | undefined;
  readonly pendingMutationIds: readonly string[];
  readonly eventIds: readonly string[];
  readonly lastSequence: number;
}

export class ReducerError extends Error {
  override readonly name = "ReducerError";
}

export const isTerminal = (state: RunState): boolean =>
  (['succeeded', 'succeeded_with_cleanup_warning', 'failed', 'cancelled'] as const).includes(state.status as TerminalStatus);

const ensure = (condition: boolean, message: string): void => {
  if (!condition) throw new ReducerError(message);
};

const ensureActive = (state: RunState): void => ensure(!isTerminal(state), "cannot apply an event after terminal state");

const verifyHeader = (state: RunState | undefined, event: JournalEvent): void => {
  ensure(Number.isInteger(event.sequence) && event.sequence > 0, "event sequence must be a positive integer");
  if (state === undefined) {
    ensure(event.sequence === 1, "first event sequence must be 1");
    ensure(event.payload._tag === "run_created", "first event must create the run");
    ensure(event.correlationId === event.runId, "correlation ID must equal run ID");
    return;
  }
  ensure(event.runId === state.runId, "event run ID does not match state");
  ensure(event.correlationId === state.runId, "event correlation ID does not match run ID");
  ensure(event.sequence === state.lastSequence + 1, "event sequence is not contiguous");
  ensure(!state.eventIds.includes(event.eventId), "event ID is duplicated");
};

const withEvent = (state: RunState, event: JournalEvent, patch: Partial<RunState>): RunState => ({
  ...state,
  ...patch,
  eventIds: [...state.eventIds, event.eventId],
  lastSequence: event.sequence,
});

const initialState = (event: JournalEvent): RunState => {
  const payload = event.payload;
  if (payload._tag !== "run_created") throw new ReducerError("first event must create the run");
  return {
    schemaVersion: 1,
    runId: event.runId,
    task: payload.task,
    status: "created",
    taskStatus: "pending",
    revisionRequests: 0,
    currentCommitId: undefined,
    terminalReason: undefined,
    pendingMutationIds: [],
    eventIds: [event.eventId],
    lastSequence: event.sequence,
  };
};

/**
 * Reduces coordinator facts only. It has no filesystem, process, or Pi dependencies.
 * This is the domain authority required by DESIGN-effect-event-sourcing.
 */
export const reduce = (state: RunState | undefined, event: JournalEvent): RunState => {
  verifyHeader(state, event);
  if (state === undefined) return initialState(event);
  ensureActive(state);

  const payload = event.payload;
  switch (payload._tag) {
    case "run_created":
      throw new ReducerError("a run may be created only once");
    case "external_intent":
      ensure(!state.pendingMutationIds.includes(payload.mutationId), "mutation intent is duplicated");
      return withEvent(state, event, {
        pendingMutationIds: [...state.pendingMutationIds, payload.mutationId],
      });
    case "external_outcome":
      ensure(state.pendingMutationIds.includes(payload.mutationId), "mutation outcome has no prior intent");
      return withEvent(state, event, {
        pendingMutationIds: state.pendingMutationIds.filter((id) => id !== payload.mutationId),
      });
    case "worker_started":
      ensure(state.status === "created", "worker may start only after run creation");
      return withEvent(state, event, { status: "running", taskStatus: "running" });
    case "worker_result_validated":
      ensure(state.status === "running", "worker result requires a running worker");
      return withEvent(state, event, {
        status: "awaiting_review",
        taskStatus: "awaiting_review",
        currentCommitId: payload.commitId,
      });
    case "review_revision_requested":
      ensure(state.status === "awaiting_review", "revision request requires a reviewable result");
      ensure(payload.commitId === state.currentCommitId, "revision request is bound to another commit");
      ensure(state.revisionRequests === 0, "review revision budget is exhausted");
      return withEvent(state, event, {
        status: "revision_requested",
        taskStatus: "revision_requested",
        revisionRequests: 1,
      });
    case "worker_revised":
      ensure(state.status === "revision_requested", "worker revision requires reviewer findings");
      return withEvent(state, event, {
        status: "awaiting_review",
        taskStatus: "awaiting_review",
        currentCommitId: payload.commitId,
      });
    case "review_approved":
      ensure(state.status === "awaiting_review", "approval requires a reviewable result");
      ensure(payload.commitId === state.currentCommitId, "approval is bound to another commit");
      return withEvent(state, event, { status: "approved", taskStatus: "approved" });
    case "integration_started":
      ensure(state.status === "approved", "integration requires approval");
      ensure(payload.commitId === state.currentCommitId, "integration is bound to another commit");
      return withEvent(state, event, { status: "integrating" });
    case "integration_succeeded":
      ensure(state.status === "integrating", "integration result requires integration");
      ensure(payload.commitId === state.currentCommitId, "integrated commit differs from approval");
      return withEvent(state, event, { status: "cleaning", taskStatus: "integrated" });
    case "cleanup_succeeded":
      ensure(state.status === "cleaning", "cleanup success requires completed integration");
      ensure(state.pendingMutationIds.length === 0, "successful run has unresolved external mutations");
      return withEvent(state, event, { status: "succeeded" });
    case "cleanup_failed":
      ensure(state.status === "cleaning", "cleanup failure requires completed integration");
      return withEvent(state, event, {
        status: "succeeded_with_cleanup_warning",
        terminalReason: payload.reason,
      });
    case "cancellation_requested":
      return withEvent(state, event, { status: "cancelling", taskStatus: "cancelling" });
    case "run_cancelled":
      ensure(state.status === "cancelling", "run cancellation requires cancellation request");
      return withEvent(state, event, { status: "cancelled", taskStatus: "cancelled" });
    case "agent_blocked":
      return withEvent(state, event, {
        status: "blocked",
        taskStatus: "blocked",
        terminalReason: payload.diagnostic,
      });
    case "run_failed":
      return withEvent(state, event, {
        status: "failed",
        taskStatus: "failed",
        terminalReason: payload.reason,
      });
  }
};

export const replay = (events: Iterable<JournalEvent>): RunState => {
  let state: RunState | undefined;
  for (const event of events) state = reduce(state, event);
  if (state === undefined) throw new ReducerError("journal contains no events");
  return state;
};
