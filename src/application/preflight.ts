import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

import { decodeHerdrSchemaHeader } from "../domain/preflight-schema.js";
import type { PiMode } from "../command.js";
import type { CommandResult, PreflightEnvironment } from "../ports/preflight.js";

export type PreflightIssueCode =
  | "unsupported_mode"
  | "project_untrusted"
  | "empty_task"
  | "parent_model_unauthenticated"
  | "unsupported_platform"
  | "unsupported_filesystem"
  | "command_unavailable"
  | "command_failed"
  | "invalid_herdr_schema"
  | "missing_herdr_capability"
  | "not_colocated_jj_git"
  | "working_copy_not_empty"
  | "assigned_base_unavailable"
  | "assigned_base_mutable"
  | "state_directory_unwritable"
  | "artifact_ignore_unwritable";

export interface PreflightIssue {
  readonly code: PreflightIssueCode;
  readonly message: string;
}

export interface PreflightEvidence {
  readonly piVersion: string;
  readonly nodeVersion: string;
  readonly herdrVersion: string;
  readonly herdrProtocol: number;
  readonly herdrSchemaVersion: number;
  readonly riftHelp: string;
  readonly jjVersion: string;
  readonly gitVersion: string;
  readonly sourceRoot: string;
  readonly assignedBaseCommitId: string;
  readonly assignedBaseChangeId: string;
  readonly repositoryId: string;
  readonly stateDirectory: string;
}

export type PreflightResult =
  | { readonly _tag: "preflight_failed"; readonly issues: readonly PreflightIssue[] }
  | { readonly _tag: "preflight_passed"; readonly evidence: PreflightEvidence };

export interface PreflightRequest {
  readonly mode: PiMode;
  readonly projectTrusted: boolean;
  readonly task: string;
  readonly parentModelAuthenticated: boolean;
  readonly cwd: string;
}

const requiredHerdrCapabilities = ["agent.start", "agent.get", "agent.send", "pane.send_keys", "pane.close", "session.snapshot"] as const;

const commandDisplay = (executable: string, arguments_: readonly string[]): string =>
  [executable, ...arguments_].join(" ");

const firstLine = (value: string): string => value.trim().split("\n")[0] ?? "";

const issue = (code: PreflightIssueCode, message: string): PreflightIssue => ({ code, message });

const commandFailure = (executable: string, arguments_: readonly string[], result: CommandResult): PreflightIssue => {
  const detail = firstLine(result.stderr) || firstLine(result.stdout) || `exit ${result.exitCode}`;
  return issue(
    result.exitCode === 127 ? "command_unavailable" : "command_failed",
    `${commandDisplay(executable, arguments_)}: ${detail}`,
  );
};

const runRequired = async (
  environment: PreflightEnvironment,
  executable: string,
  arguments_: readonly string[],
  cwd: string,
  issues: PreflightIssue[],
): Promise<string | undefined> => {
  const result = await environment.run(executable, arguments_, cwd);
  if (result.exitCode !== 0) {
    issues.push(commandFailure(executable, arguments_, result));
    return undefined;
  }
  return result.stdout;
};

const repositoryIdFor = (sourceRoot: string): string =>
  createHash("sha256").update(`pi-subagents:v1:${sourceRoot}`).digest("hex");

const capabilityPresent = (schema: unknown, capability: string): boolean => {
  if (Array.isArray(schema)) return schema.some((value) => capabilityPresent(value, capability));
  if (typeof schema !== "object" || schema === null) return false;
  const record = schema as Record<string, unknown>;
  return record.const === capability || Object.values(record).some((value) => capabilityPresent(value, capability));
};

/**
 * Performs only fixed read-only probes. It never creates state, Rifts, refs, panes,
 * agents, or journals; callers may start an orchestration run only after a pass.
 */
export const runPreflight = async (
  request: PreflightRequest,
  environment: PreflightEnvironment,
): Promise<PreflightResult> => {
  const gateIssues: PreflightIssue[] = [];
  if (request.mode !== "tui") gateIssues.push(issue("unsupported_mode", "Subagent orchestration requires Pi TUI mode."));
  if (!request.projectTrusted) gateIssues.push(issue("project_untrusted", "Trust this project before starting subagent orchestration."));
  if (request.task.trim().length === 0) gateIssues.push(issue("empty_task", "A non-empty task is required."));
  if (!request.parentModelAuthenticated) {
    gateIssues.push(issue("parent_model_unauthenticated", "The active parent model has no configured authentication."));
  }
  if (gateIssues.length > 0) return { _tag: "preflight_failed", issues: gateIssues };

  const issues: PreflightIssue[] = [];
  if (environment.platform !== "linux") {
    issues.push(issue("unsupported_platform", `Linux is required; found ${environment.platform}.`));
    return { _tag: "preflight_failed", issues };
  }

  const filesystemType = await environment.filesystemType(request.cwd);
  if (filesystemType !== "btrfs") {
    issues.push(issue("unsupported_filesystem", `btrfs is required; found ${filesystemType}.`));
  }

  const piVersion = await runRequired(environment, "pi", ["--version"], request.cwd, issues);
  const herdrVersion = await runRequired(environment, "herdr", ["--version"], request.cwd, issues);
  const herdrSchemaText = await runRequired(environment, "herdr", ["api", "schema", "--json"], request.cwd, issues);
  const riftHelp = await runRequired(environment, "rift", ["--help"], request.cwd, issues);
  const riftCreateHelp = await runRequired(environment, "rift", ["create", "--help"], request.cwd, issues);
  const jjVersion = await runRequired(environment, "jj", ["--version"], request.cwd, issues);
  const gitVersion = await runRequired(environment, "git", ["--version"], request.cwd, issues);

  let herdrProtocol: number | undefined;
  let herdrSchemaVersion: number | undefined;
  if (herdrSchemaText !== undefined) {
    try {
      const schema = JSON.parse(herdrSchemaText) as unknown;
      const header = decodeHerdrSchemaHeader(schema);
      if (!Number.isInteger(header.protocol) || header.protocol <= 0 || !Number.isInteger(header.schema_version) || header.schema_version <= 0) {
        throw new Error("protocol and schema_version must be positive integers");
      }
      herdrProtocol = header.protocol;
      herdrSchemaVersion = header.schema_version;
      for (const capability of requiredHerdrCapabilities) {
        if (!capabilityPresent(schema, capability)) {
          issues.push(issue("missing_herdr_capability", `Installed Herdr schema lacks ${capability}.`));
        }
      }
    } catch (error) {
      issues.push(issue("invalid_herdr_schema", `Cannot decode installed Herdr schema: ${String(error)}`));
    }
  }

  if (riftHelp === undefined || riftCreateHelp === undefined) {
    // The command diagnostics above are the authority for this failure.
  } else if (!riftHelp.includes("create") || !riftCreateHelp.includes("--copy-all") || !riftCreateHelp.includes("--no-hooks")) {
    issues.push(issue("command_failed", "Installed Rift lacks required create, --copy-all, or --no-hooks capability."));
  }

  const jjRoot = await runRequired(environment, "jj", ["root"], request.cwd, issues);
  const gitRoot = await runRequired(environment, "git", ["rev-parse", "--show-toplevel"], request.cwd, issues);
  let sourceRoot: string | undefined;
  if (jjRoot !== undefined && gitRoot !== undefined) {
    const [canonicalJjRoot, canonicalGitRoot] = await Promise.all([
      environment.canonicalPath(jjRoot.trim()),
      environment.canonicalPath(gitRoot.trim()),
    ]);
    if (canonicalJjRoot !== canonicalGitRoot) {
      issues.push(issue("not_colocated_jj_git", "Jujutsu and Git roots differ; a colocated repository is required."));
    } else {
      sourceRoot = canonicalJjRoot;
    }
  } else {
    issues.push(issue("not_colocated_jj_git", "A colocated Jujutsu/Git repository is required."));
  }

  const workingCopyEmpty = await runRequired(environment, "jj", ["log", "--no-graph", "-r", "@", "-T", "empty"], request.cwd, issues);
  if (workingCopyEmpty !== undefined && workingCopyEmpty.trim() !== "true") {
    issues.push(issue("working_copy_not_empty", "Current Jujutsu working copy @ must be empty."));
  }

  const base = await runRequired(
    environment,
    "jj",
    ["log", "--no-graph", "-r", "@-", "-T", 'commit_id ++ "\\t" ++ change_id'],
    request.cwd,
    issues,
  );
  const immutableBase = await runRequired(environment, "jj", ["log", "--no-graph", "-r", "@- & immutable_heads()", "-T", "commit_id"], request.cwd, issues);
  const baseParts = base?.trim().split("\t");
  if (baseParts?.length !== 2 || baseParts[0] === "" || baseParts[1] === "") {
    issues.push(issue("assigned_base_unavailable", "Assigned base @- cannot be resolved to exact commit and change IDs."));
  }
  if (immutableBase?.trim() === "") {
    issues.push(issue("assigned_base_mutable", "Assigned base @- must be immutable before a run starts."));
  }

  let repositoryId: string | undefined;
  let stateDirectory: string | undefined;
  if (sourceRoot !== undefined) {
    repositoryId = repositoryIdFor(sourceRoot);
    stateDirectory = environment.coordinatorStateDirectory(repositoryId);
    if (!(await environment.canWriteDirectory(stateDirectory))) {
      issues.push(issue("state_directory_unwritable", `Coordinator state path is not writable: ${stateDirectory}`));
    }
  }

  const artifactIgnorePath = await runRequired(
    environment,
    "git",
    ["rev-parse", "--git-path", "info/exclude"],
    request.cwd,
    issues,
  );
  if (artifactIgnorePath !== undefined) {
    const absoluteIgnorePath = resolve(request.cwd, artifactIgnorePath.trim());
    if (!(await environment.canWriteDirectory(dirname(absoluteIgnorePath)))) {
      issues.push(issue("artifact_ignore_unwritable", `Artifact ignore directory is not writable: ${dirname(absoluteIgnorePath)}`));
    }
  }

  if (
    issues.length > 0 ||
    piVersion === undefined ||
    herdrVersion === undefined ||
    riftHelp === undefined ||
    jjVersion === undefined ||
    gitVersion === undefined ||
    herdrProtocol === undefined ||
    herdrSchemaVersion === undefined ||
    sourceRoot === undefined ||
    repositoryId === undefined ||
    stateDirectory === undefined ||
    baseParts === undefined
  ) {
    return { _tag: "preflight_failed", issues };
  }

  return {
    _tag: "preflight_passed",
    evidence: {
      piVersion: firstLine(piVersion),
      nodeVersion: environment.nodeVersion,
      herdrVersion: firstLine(herdrVersion),
      herdrProtocol,
      herdrSchemaVersion,
      riftHelp: firstLine(riftHelp),
      jjVersion: firstLine(jjVersion),
      gitVersion: firstLine(gitVersion),
      sourceRoot,
      assignedBaseCommitId: baseParts[0],
      assignedBaseChangeId: baseParts[1],
      repositoryId,
      stateDirectory,
    },
  };
};
