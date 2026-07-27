import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

import { decodeHerdrSchemaHeader } from "../domain/preflight-schema.js";
import type { DoctorCheck, DoctorCheckId, DoctorEvidence, DoctorIssue, DoctorIssueCode, DoctorReport } from "../domain/doctor-schema.js";
import type { CommandResult, PreflightEnvironment } from "../ports/preflight.js";

const requiredHerdrCapabilities = ["agent.start", "agent.get", "agent.send", "pane.send_keys", "pane.close", "session.snapshot"] as const;

const firstLine = (value: string): string => (value.trim().split("\n")[0] ?? "")
  .replace(/[\u0000-\u001f\u007f]/g, " ")
  .replace(/\s+/g, " ")
  .slice(0, 256);
const commandDisplay = (executable: string, arguments_: readonly string[]): string => [executable, ...arguments_].join(" ");
const repositoryIdFor = (sourceRoot: string): string => createHash("sha256").update(`pi-subagents:v1:${sourceRoot}`).digest("hex");

const capabilityPresent = (schema: unknown, capability: string): boolean => {
  if (Array.isArray(schema)) return schema.some((value) => capabilityPresent(value, capability));
  if (typeof schema !== "object" || schema === null) return false;
  const record = schema as Record<string, unknown>;
  return record.const === capability || Object.values(record).some((value) => capabilityPresent(value, capability));
};

const commandIssue = (result: CommandResult, executable: string, arguments_: readonly string[]): DoctorIssue => {
  const unavailable = result.exitCode === 127;
  return {
    code: unavailable ? "command_unavailable" : "command_failed",
    message: unavailable ? `${commandDisplay(executable, arguments_)} is unavailable.` : `${commandDisplay(executable, arguments_)} exited with status ${result.exitCode}.`,
    remediation: unavailable ? `Install ${executable} and ensure it is available on PATH.` : `Correct the reported ${executable} failure and run doctor again.`,
  };
};

const issue = (code: DoctorIssueCode, message: string, remediation: string): DoctorIssue => ({ code, message, remediation });

/**
 * Performs the fixed read-only runtime and repository probes shared by preflight and doctor
 * surfaces. It never creates state, Rifts, refs, panes, agents, or journals.
 */
export const runDoctor = async (
  request: { readonly cwd: string },
  environment: PreflightEnvironment,
): Promise<DoctorReport> => {
  const checks: DoctorCheck[] = [];
  const issues: DoctorIssue[] = [];
  const pass = (id: DoctorCheckId, evidence?: string): void => { checks.push({ id, status: "passed", evidence, issue: undefined }); };
  const fail = (id: DoctorCheckId, value: DoctorIssue): void => { checks.push({ id, status: "failed", evidence: undefined, issue: value }); issues.push(value); };
  const report = (evidence?: DoctorEvidence): DoctorReport => ({ schemaVersion: 1, status: evidence === undefined ? "failed" : "passed", checks, issues, evidence });
  const command = async (id: DoctorCheckId, executable: string, arguments_: readonly string[]): Promise<string | undefined> => {
    const result = await environment.run(executable, arguments_, request.cwd);
    if (result.exitCode !== 0) { fail(id, commandIssue(result, executable, arguments_)); return undefined; }
    return result.stdout;
  };

  if (environment.platform !== "linux") {
    fail("platform", issue("unsupported_platform", `Linux is required; found ${environment.platform}.`, "Run pi-subagents on a supported Linux host."));
    return report();
  }
  pass("platform", environment.platform);

  const filesystemType = await environment.filesystemType(request.cwd);
  if (filesystemType !== "btrfs") fail("filesystem", issue("unsupported_filesystem", `btrfs is required; found ${filesystemType}.`, "Use a btrfs checkout before starting a run."));
  else pass("filesystem", filesystemType);

  const piVersion = await command("pi_version", "pi", ["--version"]);
  if (piVersion !== undefined) pass("pi_version", firstLine(piVersion));
  const herdrVersion = await command("herdr_version", "herdr", ["--version"]);
  if (herdrVersion !== undefined) pass("herdr_version", firstLine(herdrVersion));
  const herdrSchemaText = await command("herdr_schema", "herdr", ["api", "schema", "--json"]);
  const riftHelp = await command("rift_help", "rift", ["--help"]);
  if (riftHelp !== undefined) pass("rift_help", firstLine(riftHelp));
  const riftCreateHelp = await command("rift_create_capability", "rift", ["create", "--help"]);
  const jjVersion = await command("jj_version", "jj", ["--version"]);
  if (jjVersion !== undefined) pass("jj_version", firstLine(jjVersion));
  const gitVersion = await command("git_version", "git", ["--version"]);
  if (gitVersion !== undefined) pass("git_version", firstLine(gitVersion));

  let herdrProtocol: number | undefined;
  let herdrSchemaVersion: number | undefined;
  if (herdrSchemaText !== undefined) {
    try {
      const schema = JSON.parse(herdrSchemaText) as unknown;
      const header = decodeHerdrSchemaHeader(schema);
      if (!Number.isInteger(header.protocol) || header.protocol <= 0 || !Number.isInteger(header.schema_version) || header.schema_version <= 0) throw new Error("protocol and schema_version must be positive integers");
      herdrProtocol = header.protocol;
      herdrSchemaVersion = header.schema_version;
      const missing = requiredHerdrCapabilities.filter((capability) => !capabilityPresent(schema, capability));
      if (missing.length > 0) fail("herdr_schema", issue("missing_herdr_capability", `Installed Herdr schema lacks ${missing.join(", ")}.`, "Install a Herdr version whose schema provides every required operation."));
      else pass("herdr_schema", `protocol ${herdrProtocol}, schema ${herdrSchemaVersion}`);
    } catch {
      fail("herdr_schema", issue("invalid_herdr_schema", "Cannot decode installed Herdr schema.", "Install a Herdr version that returns a valid supported API schema."));
    }
  }

  if (riftHelp !== undefined && riftCreateHelp !== undefined) {
    if (!riftHelp.includes("create") || !riftCreateHelp.includes("--copy-all") || !riftCreateHelp.includes("--no-hooks")) {
      fail("rift_create_capability", issue("command_failed", "Installed Rift lacks required create, --copy-all, or --no-hooks capability.", "Install a Rift version with exact copy-all creation and hooks disabled."));
    } else pass("rift_create_capability", "create --copy-all --no-hooks");
  }

  const jjRoot = await command("jj_root", "jj", ["root"]);
  if (jjRoot !== undefined) pass("jj_root", jjRoot.trim());
  const gitRoot = await command("git_root", "git", ["rev-parse", "--show-toplevel"]);
  if (gitRoot !== undefined) pass("git_root", gitRoot.trim());
  let sourceRoot: string | undefined;
  if (jjRoot !== undefined && gitRoot !== undefined) {
    const canonicalJjRoot = await environment.canonicalPath(jjRoot.trim());
    const canonicalGitRoot = await environment.canonicalPath(gitRoot.trim());
    if (canonicalJjRoot !== canonicalGitRoot) fail("repository_colocation", issue("not_colocated_jj_git", "Jujutsu and Git roots differ; a colocated repository is required.", "Initialize or select a colocated Jujutsu/Git repository."));
    else { sourceRoot = canonicalJjRoot; pass("repository_colocation", sourceRoot); }
  } else fail("repository_colocation", issue("not_colocated_jj_git", "A colocated Jujutsu/Git repository is required.", "Initialize or select a colocated Jujutsu/Git repository."));

  const workingCopyEmpty = await command("working_copy_empty", "jj", ["log", "--no-graph", "-r", "@", "-T", "empty"]);
  if (workingCopyEmpty !== undefined) {
    if (workingCopyEmpty.trim() === "true") pass("working_copy_empty", "true");
    else fail("working_copy_empty", issue("working_copy_not_empty", "Current Jujutsu working copy @ must be empty.", "Commit, abandon, or otherwise clear @ before starting a run."));
  }
  const workingCopyConflict = await command("working_copy_conflict_free", "jj", ["log", "--no-graph", "-r", "@", "-T", "conflict"]);
  if (workingCopyConflict !== undefined) {
    if (workingCopyConflict.trim() === "false") pass("working_copy_conflict_free", "false");
    else fail("working_copy_conflict_free", issue("working_copy_conflicted", "Current Jujutsu working copy @ must be conflict-free.", "Resolve structural Jujutsu conflicts before starting a run."));
  }
  const base = await command("assigned_base_identity", "jj", ["log", "--no-graph", "-r", "@-", "-T", 'commit_id ++ "\\t" ++ change_id']);
  const baseParts = base?.trim().split("\t");
  if (base !== undefined) {
    if (baseParts?.length === 2 && baseParts[0] !== "" && baseParts[1] !== "") pass("assigned_base_identity", base.trim());
    else fail("assigned_base_identity", issue("assigned_base_unavailable", "Assigned base @- cannot be resolved to exact commit and change IDs.", "Create or select a repository with a resolvable parent change."));
  }
  const immutableBase = await command("assigned_base_immutable", "jj", ["log", "--no-graph", "-r", "@- & immutable_heads()", "-T", "commit_id"]);
  if (immutableBase !== undefined) {
    if (immutableBase.trim() !== "") pass("assigned_base_immutable", immutableBase.trim());
    else fail("assigned_base_immutable", issue("assigned_base_mutable", "Assigned base @- must be immutable before a run starts.", "Make the assigned base immutable before starting a run."));
  }

  let repositoryId: string | undefined;
  let stateDirectory: string | undefined;
  if (sourceRoot !== undefined) {
    repositoryId = repositoryIdFor(sourceRoot);
    stateDirectory = environment.coordinatorStateDirectory(repositoryId);
    if (await environment.canWriteDirectory(stateDirectory)) pass("state_directory", stateDirectory);
    else fail("state_directory", issue("state_directory_unwritable", `Coordinator state path is not writable: ${stateDirectory}`, "Grant write access to the coordinator state parent directory."));
  }

  const artifactIgnorePath = await command("artifact_ignore_path", "git", ["rev-parse", "--git-path", "info/exclude"]);
  if (artifactIgnorePath !== undefined) {
    const absoluteIgnorePath = resolve(request.cwd, artifactIgnorePath.trim());
    if (await environment.canWriteDirectory(dirname(absoluteIgnorePath))) pass("artifact_ignore_path", absoluteIgnorePath);
    else fail("artifact_ignore_path", issue("artifact_ignore_unwritable", `Artifact ignore directory is not writable: ${dirname(absoluteIgnorePath)}`, "Grant write access to the repository-local Git exclude directory."));
  }

  if (
    issues.length > 0 || piVersion === undefined || herdrVersion === undefined || riftHelp === undefined || jjVersion === undefined || gitVersion === undefined ||
    herdrProtocol === undefined || herdrSchemaVersion === undefined || sourceRoot === undefined || repositoryId === undefined || stateDirectory === undefined ||
    baseParts === undefined || baseParts.length !== 2 || baseParts[0] === "" || baseParts[1] === ""
  ) return report();
  return report({ piVersion: firstLine(piVersion), nodeVersion: environment.nodeVersion, herdrVersion: firstLine(herdrVersion), herdrProtocol, herdrSchemaVersion, riftHelp: firstLine(riftHelp), jjVersion: firstLine(jjVersion), gitVersion: firstLine(gitVersion), sourceRoot, assignedBaseCommitId: baseParts[0], assignedBaseChangeId: baseParts[1], repositoryId, stateDirectory });
};
