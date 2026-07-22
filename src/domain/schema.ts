import { Schema } from "effect";

const IsoTimestamp = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
);

const Identifier = Schema.NonEmptyString;
const CommitId = Schema.NonEmptyString;

export const RunCommandSchema = Schema.Union(
  Schema.TaggedStruct("start_run", {
    schemaVersion: Schema.Literal(1),
    commandId: Schema.UUID,
    runId: Identifier,
    repositoryId: Identifier,
    task: Schema.NonEmptyString,
  }),
  Schema.TaggedStruct("cancel_run", {
    schemaVersion: Schema.Literal(1),
    commandId: Schema.UUID,
    runId: Identifier,
  }),
);

export const RunStatusSchema = Schema.Literal(
  "created",
  "running",
  "awaiting_review",
  "revision_requested",
  "approved",
  "integrating",
  "cleaning",
  "blocked",
  "cancelling",
  "succeeded",
  "succeeded_with_cleanup_warning",
  "failed",
  "cancelled",
);

export const TaskStatusSchema = Schema.Literal(
  "pending",
  "running",
  "awaiting_review",
  "revision_requested",
  "approved",
  "integrated",
  "blocked",
  "cancelling",
  "failed",
  "cancelled",
);

/** The pure reducer's complete, version-one direct-run state shape. */
export const RunStateSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: Identifier,
  task: Schema.NonEmptyString,
  status: RunStatusSchema,
  taskStatus: TaskStatusSchema,
  revisionRequests: Schema.Number,
  currentCommitId: Schema.UndefinedOr(CommitId),
  terminalReason: Schema.UndefinedOr(Schema.NonEmptyString),
  pendingMutationIds: Schema.Array(Identifier),
  eventIds: Schema.Array(Schema.UUID),
  lastSequence: Schema.Number,
});

export const EventPayloadSchema = Schema.Union(
  Schema.TaggedStruct("run_created", { task: Schema.NonEmptyString }),
  Schema.TaggedStruct("external_intent", {
    mutationId: Identifier,
    operation: Schema.NonEmptyString,
  }),
  Schema.TaggedStruct("external_outcome", {
    mutationId: Identifier,
    outcome: Schema.Literal("succeeded", "failed"),
  }),
  Schema.TaggedStruct("worker_started", {}),
  Schema.TaggedStruct("worker_result_validated", { commitId: CommitId }),
  Schema.TaggedStruct("review_revision_requested", {
    commitId: CommitId,
    findings: Schema.NonEmptyString,
  }),
  Schema.TaggedStruct("worker_revised", { commitId: CommitId }),
  Schema.TaggedStruct("review_approved", { commitId: CommitId }),
  Schema.TaggedStruct("integration_started", { commitId: CommitId }),
  Schema.TaggedStruct("integration_succeeded", { commitId: CommitId }),
  Schema.TaggedStruct("cancellation_requested", {}),
  Schema.TaggedStruct("run_cancelled", {}),
  Schema.TaggedStruct("agent_blocked", {
    role: Schema.Literal("worker", "reviewer"),
    diagnostic: Schema.NonEmptyString,
  }),
  Schema.TaggedStruct("run_failed", { reason: Schema.NonEmptyString }),
  Schema.TaggedStruct("cleanup_succeeded", {}),
  Schema.TaggedStruct("cleanup_failed", { reason: Schema.NonEmptyString }),
);

export const JournalEventSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: Identifier,
  sequence: Schema.Number,
  eventId: Schema.UUID,
  timestamp: IsoTimestamp,
  causationId: Identifier,
  correlationId: Identifier,
  payload: EventPayloadSchema,
});

export type RunCommand = Schema.Schema.Type<typeof RunCommandSchema>;
export type PersistedRunState = Schema.Schema.Type<typeof RunStateSchema>;
export type EventPayload = Schema.Schema.Type<typeof EventPayloadSchema>;
export type JournalEvent = Schema.Schema.Type<typeof JournalEventSchema>;

const eventKeys = [
  "schemaVersion",
  "runId",
  "sequence",
  "eventId",
  "timestamp",
  "causationId",
  "correlationId",
  "payload",
] as const;

const payloadKeys: Readonly<Record<string, readonly string[]>> = {
  run_created: ["_tag", "task"],
  external_intent: ["_tag", "mutationId", "operation"],
  external_outcome: ["_tag", "mutationId", "outcome"],
  worker_started: ["_tag"],
  worker_result_validated: ["_tag", "commitId"],
  review_revision_requested: ["_tag", "commitId", "findings"],
  worker_revised: ["_tag", "commitId"],
  review_approved: ["_tag", "commitId"],
  integration_started: ["_tag", "commitId"],
  integration_succeeded: ["_tag", "commitId"],
  cancellation_requested: ["_tag"],
  run_cancelled: ["_tag"],
  agent_blocked: ["_tag", "role", "diagnostic"],
  run_failed: ["_tag", "reason"],
  cleanup_succeeded: ["_tag"],
  cleanup_failed: ["_tag", "reason"],
};

export class JournalDecodeError extends Error {
  override readonly name = "JournalDecodeError";
}

const exactObject = (value: unknown, keys: readonly string[], location: string): void => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new JournalDecodeError(`${location} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new JournalDecodeError(`${location} has unexpected or missing fields`);
  }
};

/** Strictly decodes the version-one, JSON-safe journal record. */
export const decodeJournalEvent = (value: unknown): JournalEvent => {
  exactObject(value, eventKeys, "journal event");
  const payload = (value as { payload: unknown }).payload;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new JournalDecodeError("journal event payload must be an object");
  }
  const tag = (payload as { _tag?: unknown })._tag;
  if (typeof tag !== "string" || payloadKeys[tag] === undefined) {
    throw new JournalDecodeError("journal event payload has an unknown tag");
  }
  exactObject(payload, payloadKeys[tag], `journal event payload ${tag}`);

  try {
    return Schema.decodeUnknownSync(JournalEventSchema)(value);
  } catch (error) {
    throw new JournalDecodeError(`invalid journal event: ${String(error)}`);
  }
};

export const decodeRunCommand = (value: unknown): RunCommand =>
  Schema.decodeUnknownSync(RunCommandSchema)(value);

export const decodeRunState = (value: unknown): PersistedRunState =>
  Schema.decodeUnknownSync(RunStateSchema)(value);
