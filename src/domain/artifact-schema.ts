import { Schema } from "effect";

const Identifier = Schema.NonEmptyString;

export const ChildRoleSchema = Schema.Literal("worker", "reviewer");
export type ChildRole = Schema.Schema.Type<typeof ChildRoleSchema>;

export const AttemptEnvelopeSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: Identifier,
  taskId: Identifier,
  attemptId: Identifier,
  role: ChildRoleSchema,
  task: Schema.NonEmptyString,
  root: Schema.NonEmptyString,
  allowedTrackedPaths: Schema.Array(Schema.NonEmptyString),
  assignedBaseCommitId: Schema.NonEmptyString,
  outputRelativePath: Schema.NonEmptyString,
});
export type AttemptEnvelope = Schema.Schema.Type<typeof AttemptEnvelopeSchema>;

export const WorkerResultSchema = Schema.TaggedStruct("worker", {
  schemaVersion: Schema.Literal(1),
  runId: Identifier,
  taskId: Identifier,
  attemptId: Identifier,
  changeId: Schema.NonEmptyString,
  commitId: Schema.NonEmptyString,
  changedPaths: Schema.Array(Schema.NonEmptyString),
});

export const ReviewerResultSchema = Schema.TaggedStruct("reviewer", {
  schemaVersion: Schema.Literal(1),
  runId: Identifier,
  taskId: Identifier,
  attemptId: Identifier,
  commitId: Schema.NonEmptyString,
  assignedBaseCommitId: Schema.NonEmptyString,
  decision: Schema.Literal("approved", "revision_requested"),
  findings: Schema.String,
});

export const ResultArtifactSchema = Schema.Union(WorkerResultSchema, ReviewerResultSchema);
export type ResultArtifact = Schema.Schema.Type<typeof ResultArtifactSchema>;

export const ChildGuardConfigSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  role: ChildRoleSchema,
  root: Schema.NonEmptyString,
  allowedTrackedPaths: Schema.Array(Schema.NonEmptyString),
  resultPath: Schema.NonEmptyString,
  envelope: AttemptEnvelopeSchema,
  maxReadBytes: Schema.Number,
  maxOutputBytes: Schema.Number,
});
export type ChildGuardConfig = Schema.Schema.Type<typeof ChildGuardConfigSchema>;

export const decodeAttemptEnvelope = (value: unknown): AttemptEnvelope =>
  Schema.decodeUnknownSync(AttemptEnvelopeSchema)(value);

export const decodeResultArtifact = (value: unknown): ResultArtifact =>
  Schema.decodeUnknownSync(ResultArtifactSchema)(value);

export const decodeChildGuardConfig = (value: unknown): ChildGuardConfig =>
  Schema.decodeUnknownSync(ChildGuardConfigSchema)(value);
