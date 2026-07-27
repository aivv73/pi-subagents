import { Schema } from "effect";

export const DoctorIssueCodeSchema = Schema.Literal(
  "unsupported_platform",
  "unsupported_filesystem",
  "command_unavailable",
  "command_failed",
  "invalid_herdr_schema",
  "missing_herdr_capability",
  "not_colocated_jj_git",
  "working_copy_not_empty",
  "working_copy_conflicted",
  "assigned_base_unavailable",
  "assigned_base_mutable",
  "state_directory_unwritable",
  "artifact_ignore_unwritable",
);
export type DoctorIssueCode = Schema.Schema.Type<typeof DoctorIssueCodeSchema>;

export const DoctorIssueSchema = Schema.Struct({
  code: DoctorIssueCodeSchema,
  message: Schema.NonEmptyString,
  remediation: Schema.NonEmptyString,
});
export type DoctorIssue = Schema.Schema.Type<typeof DoctorIssueSchema>;

export const DoctorCheckIdSchema = Schema.Literal(
  "platform",
  "filesystem",
  "pi_version",
  "herdr_version",
  "herdr_schema",
  "rift_help",
  "rift_create_capability",
  "jj_version",
  "git_version",
  "jj_root",
  "git_root",
  "repository_colocation",
  "working_copy_empty",
  "working_copy_conflict_free",
  "assigned_base_identity",
  "assigned_base_immutable",
  "state_directory",
  "artifact_ignore_path",
);
export type DoctorCheckId = Schema.Schema.Type<typeof DoctorCheckIdSchema>;

export const DoctorCheckSchema = Schema.Struct({
  id: DoctorCheckIdSchema,
  status: Schema.Literal("passed", "failed"),
  evidence: Schema.UndefinedOr(Schema.String),
  issue: Schema.UndefinedOr(DoctorIssueSchema),
});
export type DoctorCheck = Schema.Schema.Type<typeof DoctorCheckSchema>;

export const DoctorEvidenceSchema = Schema.Struct({
  piVersion: Schema.NonEmptyString,
  nodeVersion: Schema.NonEmptyString,
  herdrVersion: Schema.NonEmptyString,
  herdrProtocol: Schema.Number,
  herdrSchemaVersion: Schema.Number,
  riftHelp: Schema.NonEmptyString,
  jjVersion: Schema.NonEmptyString,
  gitVersion: Schema.NonEmptyString,
  sourceRoot: Schema.NonEmptyString,
  assignedBaseCommitId: Schema.NonEmptyString,
  assignedBaseChangeId: Schema.NonEmptyString,
  repositoryId: Schema.NonEmptyString,
  stateDirectory: Schema.NonEmptyString,
});
export type DoctorEvidence = Schema.Schema.Type<typeof DoctorEvidenceSchema>;

/** Version-one machine contract for the read-only external runtime diagnosis. */
export const DoctorReportSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  status: Schema.Literal("passed", "failed"),
  checks: Schema.Array(DoctorCheckSchema),
  issues: Schema.Array(DoctorIssueSchema),
  evidence: Schema.UndefinedOr(DoctorEvidenceSchema),
});
export type DoctorReport = Schema.Schema.Type<typeof DoctorReportSchema>;

export const decodeDoctorReport = (value: unknown): DoctorReport =>
  Schema.decodeUnknownSync(DoctorReportSchema)(value);
