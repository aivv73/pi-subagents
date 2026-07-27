#!/usr/bin/env node

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, statfs, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const optIn = process.env.PI_SUBAGENTS_ACCEPTANCE_REAL;
const model = process.env.PI_SUBAGENTS_ACCEPTANCE_MODEL?.trim();
const fixtureParent = resolve(process.env.PI_SUBAGENTS_ACCEPTANCE_ROOT ?? tmpdir());
const btrfsMagic = 0x9123683e;
const herdrCapabilities = ["agent.start", "agent.get", "agent.send", "pane.send_keys", "pane.close", "session.snapshot"];

const fail = (message) => {
  console.error(`LIVE ACCEPTANCE FAILED: ${message}`);
  process.exitCode = 1;
};

const command = async (executable, args, cwd = projectRoot) => {
  try {
    const { stdout, stderr } = await execFileAsync(executable, args, {
      cwd,
      shell: false,
      maxBuffer: 1024 * 1024,
    });
    return stdout || stderr;
  } catch (error) {
    const detail = error.stderr || error.stdout || error.message;
    throw new Error(`${executable} ${args.join(" ")}: ${String(detail).trim()}`);
  }
};

const requireBtrfs = async () => {
  let filesystem;
  try {
    filesystem = await statfs(fixtureParent);
  } catch (error) {
    throw new Error(`fixture parent is unavailable (${fixtureParent}): ${error instanceof Error ? error.message : String(error)}`);
  }
  if (Number(filesystem.type) !== btrfsMagic) {
    throw new Error(`fixture parent must be btrfs; ${fixtureParent} has filesystem type 0x${Number(filesystem.type).toString(16)}. Set PI_SUBAGENTS_ACCEPTANCE_ROOT to a btrfs directory.`);
  }
};

const requireCapabilities = async () => {
  await Promise.all([
    command("btrfs", ["--version"]),
    command("pi", ["--version"]),
    command("herdr", ["--version"]),
    command("jj", ["--version"]),
    command("git", ["--version"]),
  ]);
  const [riftHelp, riftCreateHelp, schemaText] = await Promise.all([
    command("rift", ["--help"]),
    command("rift", ["create", "--help"]),
    command("herdr", ["api", "schema", "--json"]),
  ]);
  if (!riftHelp.includes("create") || !riftCreateHelp.includes("--copy-all") || !riftCreateHelp.includes("--no-hooks")) {
    throw new Error("installed Rift lacks required create, --copy-all, or --no-hooks capability");
  }
  let schema;
  try {
    schema = JSON.parse(schemaText);
  } catch (error) {
    throw new Error(`Herdr returned an invalid API schema: ${error instanceof Error ? error.message : String(error)}`);
  }
  const serializedSchema = JSON.stringify(schema);
  const absent = herdrCapabilities.filter((capability) => !serializedSchema.includes(capability));
  if (absent.length > 0) throw new Error(`installed Herdr schema lacks ${absent.join(", ")}`);
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const buildSourceCheckout = async () => {
  try {
    await access(join(projectRoot, "tsconfig.json"));
  } catch {
    return;
  }
  await command("npm", ["run", "build"]);
};

const initializeFixture = async (fixture) => {
  const sourceRoot = join(fixture, "source");
  await mkdir(sourceRoot);
  await command("jj", ["git", "init", "--colocate", sourceRoot], fixture);
  await writeFile(join(sourceRoot, "README.md"), "smoke: pending\n", "utf8");
  await command("jj", ["describe", "-m", "Initialize live smoke fixture"], sourceRoot);
  await command("jj", ["new", "@"], sourceRoot);
  return sourceRoot;
};

const verifyOutcome = async (sourceRoot, journalPath, disposition) => {
  if (disposition._tag !== "succeeded") {
    const detail = "reason" in disposition
      ? disposition.reason
      : "warnings" in disposition
        ? disposition.warnings.join("; ")
        : "resources retained by cancellation";
    throw new Error(`supervisor finished ${disposition._tag}: ${detail}. Verify Pi authentication for ${model}.`);
  }
  assert(await readFile(join(sourceRoot, "README.md"), "utf8") === "smoke: completed\n", "worker semantic change was not integrated");
  assert((await command("jj", ["log", "--no-graph", "-r", "@", "-T", "empty"], sourceRoot)).trim() === "true", "source @ is not empty after integration");
  assert(
    (await command("jj", ["log", "--no-graph", "-r", "@-", "-T", "commit_id"], sourceRoot)).trim() === disposition.approvedCommitId,
    "source @- does not equal the approved commit",
  );
  const journal = (await readFile(journalPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line).payload._tag);
  assert(journal.includes("worker_result_validated"), "worker result was not semantically validated");
  assert(journal.includes("review_approved"), "reviewer did not approve the exact worker revision");
  assert(!journal.includes("review_revision_requested"), "live smoke unexpectedly required a reviewer revision");
  assert(journal.includes("integration_succeeded"), "approved change was not exactly integrated");
  assert(journal.includes("cleanup_succeeded"), "post-integration cleanup did not complete");
};

const main = async () => {
  if (optIn !== "1") {
    console.log("SKIP: live acceptance is disabled; set PI_SUBAGENTS_ACCEPTANCE_REAL=1 to opt in.");
    return;
  }
  if (model === undefined || model.length === 0) {
    throw new Error("PI_SUBAGENTS_ACCEPTANCE_MODEL must name an authenticated Pi model (for example provider/model)");
  }

  await requireBtrfs();
  await requireCapabilities();
  await buildSourceCheckout();

  const fixture = await mkdtemp(join(fixtureParent, "pi-subagents-live-"));
  console.log(`Live acceptance fixture: ${fixture}`);
  try {
    const sourceRoot = await initializeFixture(fixture);
    const stateDirectory = join(fixture, "state");
    const [
      { JsonlJournal },
      { LocalGitTransport },
      { NodeIntegrationRuntime },
      { NodeTerminalResourceRuntime },
      { NodeWorkerAttemptRuntime },
      { DirectRunSupervisor },
      { SingleRunRegistry },
    ] = await Promise.all([
      import("../dist/adapters/jsonl-journal.js"),
      import("../dist/adapters/local-git-transport.js"),
      import("../dist/adapters/integration-runtime.js"),
      import("../dist/adapters/terminal-resources.js"),
      import("../dist/adapters/worker-attempt-runtime.js"),
      import("../dist/application/direct-run-supervisor.js"),
      import("../dist/application/run-registry.js"),
    ]);
    const runtime = new NodeWorkerAttemptRuntime();
    const supervisor = new DirectRunSupervisor({
      ids: { next: (kind) => `live-${kind}-${randomUUID()}` },
      journals: { open: JsonlJournal.open },
      snapshots: {
        destination: (role, attemptId) => join(stateDirectory, "rifts", `${role}-${attemptId}`),
        name: (role, attemptId) => `pi-subagents-live-${role}-${attemptId}`,
      },
      registry: new SingleRunRegistry(),
      workerRuntime: runtime,
      reviewerRuntime: runtime,
      transport: new LocalGitTransport(),
      integrationRuntime: new NodeIntegrationRuntime(),
      terminalRuntime: new NodeTerminalResourceRuntime(),
    });
    const started = await supervisor.start({
      task: "Live smoke task: use only subagent tools. In README.md replace the exact text `smoke: pending` with `smoke: completed`. Inspect the current Jujutsu identity, describe the task change, and write exactly one strict worker result JSON using the identity and envelope IDs returned by the tools. Change only README.md.",
      sourceRoot,
      stateDirectory,
      assignedBaseCommitId: (await command("jj", ["log", "--no-graph", "-r", "@-", "-T", "commit_id"], sourceRoot)).trim(),
      allowedTrackedPaths: ["README.md"],
      childExtensionPath: join(projectRoot, "dist", "child-extension.js"),
      workerPromptPath: join(projectRoot, "prompts", "worker.md"),
      reviewerPromptPath: join(projectRoot, "prompts", "reviewer.md"),
      piExecutable: "pi",
      parentModel: model,
      parentEnvironment: process.env,
      onProgress: (progress) => console.log(`Live acceptance: ${progress.phase}`),
    });
    assert(started._tag === "started", `supervisor did not start: ${started._tag}`);
    const disposition = await started.completion;
    await verifyOutcome(sourceRoot, join(stateDirectory, "runs", `${started.runId}.jsonl`), disposition);
  } catch (error) {
    console.error(`Live acceptance fixture retained for inspection: ${fixture}`);
    throw error;
  }
  await rm(fixture, { recursive: true, force: false });
  console.log("LIVE ACCEPTANCE PASSED: fixture removed after verified worker, review, integration, and cleanup.");
};

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
