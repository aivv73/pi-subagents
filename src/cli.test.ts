import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { beforeAll, describe, expect, it } from "vitest";

import { runDoctorCli } from "./cli.js";
import type { DoctorReport } from "./domain/doctor-schema.js";
import type { PreflightEnvironment } from "./ports/preflight.js";

const execFile = promisify(execFileCallback);
const environment = {} as PreflightEnvironment;
const passed: DoctorReport = {
  schemaVersion: 1,
  status: "passed",
  checks: [],
  issues: [],
  evidence: {
    piVersion: "pi", nodeVersion: "node", herdrVersion: "herdr", herdrProtocol: 1, herdrSchemaVersion: 1,
    riftHelp: "rift", jjVersion: "jj", gitVersion: "git", sourceRoot: "/source", assignedBaseCommitId: "base",
    assignedBaseChangeId: "change", repositoryId: "repository", stateDirectory: "/state",
  },
};

const execute = (report: DoctorReport) => runDoctorCli(["doctor", "--json"], {
  cwd: "/source",
  environment,
  doctor: async () => report,
});

const fakeRuntime = `#!/usr/bin/env node
import { basename } from "node:path";
const command = basename(process.argv[1]);
const args = process.argv.slice(2);
const schema = { protocol: 1, schema_version: 1, schemas: { request: { anyOf: ["agent.start", "agent.get", "agent.send", "pane.send_keys", "pane.close", "session.snapshot"].map((value) => ({ const: value })) }, event: {} } };
if (command === "pi") console.log("pi 1");
else if (command === "herdr" && args[0] === "--version") console.log("herdr 1");
else if (command === "herdr") console.log(JSON.stringify(schema));
else if (command === "rift" && args[0] === "--help") console.log("create");
else if (command === "rift") console.log(process.env.FAKE_RIFT_CAPABILITY === "missing" ? "--copy-all" : "--copy-all --no-hooks");
else if (command === "jj" && args[0] === "--version") console.log("jj 1");
else if (command === "jj" && args[0] === "root") console.log(process.cwd());
else if (command === "jj" && args.join(" ").includes("empty")) console.log("true");
else if (command === "jj" && args.join(" ").includes("conflict")) console.log("false");
else if (command === "jj" && args.join(" ").includes("immutable_heads")) console.log("base");
else if (command === "jj") console.log("base\\tchange");
else if (command === "git" && args.includes("--show-toplevel")) console.log(process.cwd());
else if (command === "git" && args.includes("--git-path")) console.log(".git/info/exclude");
else if (command === "git") console.log("git 1");
`;

const invokeProcess = async (riftCapability: "present" | "missing", arguments_ = ["doctor", "--json"]) => {
  const root = await mkdtemp(join(process.cwd(), ".pi-subagents-cli-"));
  const source = join(root, "source");
  const bin = join(root, "bin");
  const home = join(root, "home");
  try {
    await Promise.all([mkdir(source), mkdir(bin), mkdir(home)]);
    await Promise.all(["pi", "herdr", "rift", "jj", "git"].map(async (name) => {
      const path = join(bin, name);
      await writeFile(path, fakeRuntime);
      await chmod(path, 0o755);
    }));
    const launcher = join(root, "pi-subagents");
    await symlink(resolve("dist/cli.js"), launcher);
    try {
      const result = await execFile(process.execPath, [launcher, ...arguments_], {
        cwd: source,
        env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, FAKE_RIFT_CAPABILITY: riftCapability },
      });
      return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      const result = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
      return { exitCode: result.code, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("standalone doctor CLI", () => {
  beforeAll(async () => { await execFile("npm", ["run", "build"]); });

  it("emits exactly one JSON report and succeeds only for a passing diagnosis", async () => {
    const result = await execute(passed);
    expect(result).toEqual({ exitCode: 0, stdout: `${JSON.stringify(passed)}\n`, stderr: "" });
    expect(JSON.parse(result.stdout)).toEqual(passed);
  });

  it("preserves a failed report on stdout and returns a diagnosis failure status", async () => {
    const failed: DoctorReport = {
      ...passed,
      status: "failed",
      evidence: undefined,
      issues: [{ code: "command_unavailable", message: "rift: not found", remediation: "Install Rift." }],
      checks: [{ id: "rift_help", status: "failed", evidence: undefined, issue: { code: "command_unavailable", message: "rift: not found", remediation: "Install Rift." } }],
    };
    await expect(execute(failed)).resolves.toEqual({ exitCode: 1, stdout: `${JSON.stringify(failed)}\n`, stderr: "" });
  });

  it("rejects invalid invocations without probing the environment", async () => {
    let called = false;
    const result = await runDoctorCli(["doctor"], { cwd: "/source", environment, doctor: async () => { called = true; return passed; } });
    expect(result).toEqual({ exitCode: 2, stdout: "", stderr: "Usage: pi-subagents doctor --json\n" });
    expect(called).toBe(false);
  });

  it("uses a distinct internal-failure status and keeps stdout empty", async () => {
    const result = await runDoctorCli(["doctor", "--json"], { cwd: "/source", environment, doctor: async () => { throw new Error("unexpected failure"); } });
    expect(result).toEqual({ exitCode: 2, stdout: "", stderr: "pi-subagents doctor failed: unexpected failure\n" });
  });

  it("runs the packaged executable with strict process output for passing and failing diagnoses", async () => {
    const passedProcess = await invokeProcess("present");
    expect(passedProcess).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(passedProcess.stdout)).toMatchObject({ schemaVersion: 1, status: "passed" });

    const failedProcess = await invokeProcess("missing");
    expect(failedProcess).toMatchObject({ exitCode: 1, stderr: "" });
    expect(JSON.parse(failedProcess.stdout)).toMatchObject({ schemaVersion: 1, status: "failed", issues: expect.arrayContaining([expect.objectContaining({ code: "command_failed" })]) });

    const invalidProcess = await invokeProcess("present", ["doctor"]);
    expect(invalidProcess).toEqual({ exitCode: 2, stdout: "", stderr: "Usage: pi-subagents doctor --json\n" });
  });
});
