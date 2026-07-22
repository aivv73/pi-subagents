import { describe, expect, it } from "vitest";

import { runPreflight, type PreflightRequest } from "./preflight.js";
import type { CommandResult, PreflightEnvironment } from "../ports/preflight.js";

const key = (executable: string, arguments_: readonly string[]): string => `${executable}\u0000${arguments_.join("\u0000")}`;
const success = (stdout: string): CommandResult => ({ exitCode: 0, stdout, stderr: "" });

const installedHerdrSchema = JSON.stringify({
  protocol: 16,
  schema_version: 1,
  schemas: {
    request: {
      anyOf: [{ const: "agent.start" }, { const: "agent.send" }, { const: "session.snapshot" }],
    },
    event: {},
  },
});

const fixture = (overrides: Partial<Record<string, CommandResult>> = {}) => {
  const calls: string[] = [];
  const results: Record<string, CommandResult> = {
    [key("pi", ["--version"])]: success("0.81.1\n"),
    [key("herdr", ["--version"])]: success("herdr 0.7.4\n"),
    [key("herdr", ["api", "schema", "--json"])]: success(installedHerdrSchema),
    [key("rift", ["--help"])]: success("Usage: rift <COMMAND>\nCommands:\n  create\n"),
    [key("rift", ["create", "--help"])]: success("--copy-all\n--no-hooks\n"),
    [key("jj", ["--version"])]: success("jj 0.43.0\n"),
    [key("git", ["--version"])]: success("git version 2.55.0\n"),
    [key("jj", ["root"])]: success("/workspace\n"),
    [key("git", ["rev-parse", "--show-toplevel"])]: success("/workspace\n"),
    [key("jj", ["log", "--no-graph", "-r", "@", "-T", "empty"])]: success("true"),
    [key("jj", ["log", "--no-graph", "-r", "@-", "-T", 'commit_id ++ "\\t" ++ change_id'])]: success("base-commit\tbase-change"),
    [key("jj", ["log", "--no-graph", "-r", "@- & immutable_heads()", "-T", "commit_id"])]: success("base-commit"),
    [key("git", ["rev-parse", "--git-path", "info/exclude"])]: success(".git/info/exclude\n"),
    ...overrides,
  };
  const environment: PreflightEnvironment = {
    platform: "linux",
    nodeVersion: "v26.4.0",
    async run(executable, arguments_) {
      calls.push(key(executable, arguments_));
      return results[key(executable, arguments_)] ?? { exitCode: 127, stdout: "", stderr: "not found" };
    },
    async filesystemType() {
      return "btrfs";
    },
    async canWriteDirectory() {
      return true;
    },
    async canonicalPath(path) {
      return path;
    },
    coordinatorStateDirectory(repositoryId) {
      return `/home/tester/.pi/agent/state/pi-subagents/${repositoryId}`;
    },
  };
  return { environment, calls };
};

const request = (overrides: Partial<PreflightRequest> = {}): PreflightRequest => ({
  mode: "tui",
  projectTrusted: true,
  task: "update README",
  parentModelAuthenticated: true,
  cwd: "/workspace",
  ...overrides,
});

describe("runPreflight", () => {
  it("returns exact tested capability evidence without creating resources", async () => {
    const { environment, calls } = fixture();
    const result = await runPreflight(request(), environment);

    expect(result).toMatchObject({
      _tag: "preflight_passed",
      evidence: {
        piVersion: "0.81.1",
        nodeVersion: "v26.4.0",
        herdrVersion: "herdr 0.7.4",
        herdrProtocol: 16,
        herdrSchemaVersion: 1,
        jjVersion: "jj 0.43.0",
        gitVersion: "git version 2.55.0",
        sourceRoot: "/workspace",
        assignedBaseCommitId: "base-commit",
        assignedBaseChangeId: "base-change",
        stateDirectory: expect.stringMatching(/^\/home\/tester\/\.pi\/agent\/state\/pi-subagents\//),
      },
    });
    expect(calls).toContain(key("herdr", ["api", "schema", "--json"]));
    expect(calls).not.toContain(key("rift", ["create"]));
    expect(calls).not.toContain(key("herdr", ["agent", "start"]));
  });

  it.each([
    ["mode", { mode: "print" as const }, "unsupported_mode"],
    ["trust", { projectTrusted: false }, "project_untrusted"],
    ["task", { task: "  " }, "empty_task"],
    ["model authentication", { parentModelAuthenticated: false }, "parent_model_unauthenticated"],
  ])("fails the %s gate before touching the environment", async (_name, overrides, code) => {
    const { environment, calls } = fixture();
    const result = await runPreflight(request(overrides), environment);
    expect(result).toMatchObject({ _tag: "preflight_failed", issues: [expect.objectContaining({ code })] });
    expect(calls).toEqual([]);
  });

  it("rejects non-btrfs and never invokes an orchestration mutation", async () => {
    const { environment, calls } = fixture();
    const nonBtrfs: PreflightEnvironment = { ...environment, filesystemType: async () => "ext4" };
    const result = await runPreflight(request(), nonBtrfs);
    expect(result).toMatchObject({ _tag: "preflight_failed", issues: [expect.objectContaining({ code: "unsupported_filesystem" })] });
    expect(calls).not.toContain(key("rift", ["create"]));
    expect(calls).not.toContain(key("herdr", ["agent", "start"]));
  });

  it("rejects missing installed Herdr schema capability instead of assuming a version", async () => {
    const schemaWithoutSend = JSON.stringify({
      protocol: 16,
      schema_version: 1,
      schemas: { request: { anyOf: [{ const: "agent.start" }, { const: "session.snapshot" }] }, event: {} },
    });
    const { environment } = fixture({
      [key("herdr", ["api", "schema", "--json"])]: success(schemaWithoutSend),
    });
    const result = await runPreflight(request(), environment);
    expect(result).toMatchObject({
      _tag: "preflight_failed",
      issues: [expect.objectContaining({ code: "missing_herdr_capability", message: expect.stringContaining("agent.send") })],
    });
  });

  it("rejects a dirty working copy, mutable base, and mismatched repository roots", async () => {
    const { environment } = fixture({
      [key("git", ["rev-parse", "--show-toplevel"])]: success("/different-root\n"),
      [key("jj", ["log", "--no-graph", "-r", "@", "-T", "empty"])]: success("false"),
      [key("jj", ["log", "--no-graph", "-r", "@- & immutable_heads()", "-T", "commit_id"])]: success(""),
    });
    const result = await runPreflight(request(), environment);
    expect(result).toMatchObject({
      _tag: "preflight_failed",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "not_colocated_jj_git" }),
        expect.objectContaining({ code: "working_copy_not_empty" }),
        expect.objectContaining({ code: "assigned_base_mutable" }),
      ]),
    });
  });

  it("reports unavailable commands and unwritable state without writing a journal", async () => {
    const { environment } = fixture({
      [key("rift", ["--help"])]: { exitCode: 127, stdout: "", stderr: "rift: not found" },
    });
    const unwritable: PreflightEnvironment = { ...environment, canWriteDirectory: async () => false };
    const result = await runPreflight(request(), unwritable);
    expect(result).toMatchObject({
      _tag: "preflight_failed",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "command_unavailable" }),
        expect.objectContaining({ code: "state_directory_unwritable" }),
        expect.objectContaining({ code: "artifact_ignore_unwritable" }),
      ]),
    });
  });
});
