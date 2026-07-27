import { execFile } from "node:child_process";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

import { createAttemptArtifacts, readResultArtifact, type AttemptArtifacts } from "./artifacts.js";
import type { AttemptEnvelope, ResultArtifact } from "../domain/artifact-schema.js";
import type { RevisionIdentity, WorkerRevisionFacts } from "../domain/worker-attempt.js";
import type { HerdrAgent, HerdrObservation, RiftSnapshot, WorkerAttemptRuntime } from "../ports/worker-attempt.js";
import type { ReviewerAttemptRuntime } from "../ports/reviewer-attempt.js";

const execFileAsync = promisify(execFile);

export class WorkerRuntimeError extends Error {
  override readonly name = "WorkerRuntimeError";
}

const command = async (executable: string, arguments_: readonly string[], cwd: string): Promise<string> => {
  try {
    const { stdout, stderr } = await execFileAsync(executable, [...arguments_], {
      cwd,
      shell: false,
      maxBuffer: 1024 * 1024,
    });
    return stdout || stderr;
  } catch (error) {
    const detail = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    throw new WorkerRuntimeError(`${executable} ${arguments_.join(" ")}: ${detail.stderr ?? detail.stdout ?? detail.message}`);
  }
};

const parseIdentity = (output: string): RevisionIdentity => {
  const [commitId, changeId] = output.trim().split("\t");
  if (commitId === undefined || changeId === undefined || commitId === "" || changeId === "") {
    throw new WorkerRuntimeError("Jujutsu did not produce an exact commit/change identity");
  }
  return { commitId, changeId };
};

type AgentInfo = { readonly agent: string; readonly pane_id: string; readonly agent_status: string };

const parseAgentInfo = (output: string): AgentInfo => {
  let value: unknown;
  try {
    value = JSON.parse(output) as unknown;
  } catch (error) {
    throw new WorkerRuntimeError(`Herdr returned invalid JSON: ${String(error)}`);
  }
  const agent = (value as { result?: { agent?: unknown } }).result?.agent;
  if (
    typeof agent !== "object" || agent === null ||
    typeof (agent as { agent?: unknown }).agent !== "string" ||
    typeof (agent as { pane_id?: unknown }).pane_id !== "string" ||
    typeof (agent as { agent_status?: unknown }).agent_status !== "string"
  ) {
    throw new WorkerRuntimeError("Herdr response lacks agent, pane, or status identity");
  }
  return agent as AgentInfo;
};

const sleep = async (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Fixed-argv command adapter. It never invokes Rift removal, generic shells, or upstream Git. */
export class NodeWorkerAttemptRuntime implements WorkerAttemptRuntime, ReviewerAttemptRuntime {
  constructor(
    private readonly options: {
      readonly riftExecutable?: string;
      readonly jjExecutable?: string;
      readonly herdrExecutable?: string;
      readonly startupTimeoutMs?: number;
      readonly settlementTimeoutMs?: number;
    } = {},
  ) {}

  async createExactSnapshot(request: { readonly sourceRoot: string; readonly destination: string; readonly name: string }): Promise<RiftSnapshot> {
    const rift = this.options.riftExecutable ?? "rift";
    await mkdir(dirname(request.destination), { recursive: true });
    await command(rift, ["init", request.sourceRoot], request.sourceRoot);
    await command(rift, ["create", request.sourceRoot, "--into", request.destination, "--name", request.name, "--copy-all", "--no-hooks"], request.sourceRoot);
    const root = await realpath(request.destination);
    const metadata = await lstat(root);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new WorkerRuntimeError("Rift snapshot is not a real directory");
    return { id: request.name, root };
  }

  currentRevision(root: string): Promise<RevisionIdentity> {
    return command(this.options.jjExecutable ?? "jj", ["log", "--no-graph", "-r", "@", "-T", 'commit_id ++ "\\t" ++ change_id'], root).then(parseIdentity);
  }

  async createFreshTaskChange(root: string, assignedBaseCommitId: string): Promise<RevisionIdentity> {
    await command(this.options.jjExecutable ?? "jj", ["new", assignedBaseCommitId], root);
    return this.currentRevision(root);
  }

  createArtifacts(root: string, envelope: AttemptEnvelope): Promise<AttemptArtifacts> {
    return createAttemptArtifacts(root, envelope);
  }

  readResult(artifacts: AttemptArtifacts): Promise<ResultArtifact> {
    return readResultArtifact(artifacts);
  }

  async inspectWorkerRevision(root: string, assignedBaseCommitId: string): Promise<WorkerRevisionFacts> {
    return this.inspectRevision(root, "@", assignedBaseCommitId);
  }

  async inspectRevision(root: string, revision: string, assignedBaseCommitId: string): Promise<WorkerRevisionFacts> {
    const jj = this.options.jjExecutable ?? "jj";
    const identity = parseIdentity(await command(jj, ["log", "--no-graph", "-r", revision, "-T", 'commit_id ++ "\\t" ++ change_id'], root));
    const [parents, revisionCommits, descendant, description, changedPaths, trackedPaths, conflicted] = await Promise.all([
      command(jj, ["log", "--no-graph", "-r", revision, "-T", 'parents.map(|p| p.commit_id()).join(",")'], root),
      command(jj, ["log", "--no-graph", "-r", `${revision} & descendants(${assignedBaseCommitId})`, "-T", "commit_id"], root),
      command(jj, ["log", "--no-graph", "-r", `${revision} & descendants(${assignedBaseCommitId})`, "-T", "commit_id"], root),
      command(jj, ["log", "--no-graph", "-r", revision, "-T", "description"], root),
      command(jj, ["diff", "--name-only", "-r", revision], root),
      command(jj, ["file", "list", "-r", revision], root),
      command(jj, ["log", "--no-graph", "-r", revision, "-T", "conflict"], root),
    ]);
    return {
      ...identity,
      assignedBaseCommitId,
      parentCommitIds: parents.trim() === "" ? [] : parents.trim().split(","),
      revisionCommitIds: revisionCommits.trim() === "" ? [] : revisionCommits.trim().split("\n"),
      isDescendantOfAssignedBase: descendant.trim() === identity.commitId,
      isConflicted: conflicted.trim() !== "false",
      description,
      changedPaths: changedPaths.trim() === "" ? [] : changedPaths.trim().split("\n"),
      trackedArtifactPaths: trackedPaths.trim().split("\n").filter((path) => path === ".pi-subagents" || path.startsWith(".pi-subagents/")),
    };
  }

  resolveTransportRef(root: string, transportRef: string): Promise<RevisionIdentity> {
    return command(this.options.jjExecutable ?? "jj", ["log", "--no-graph", "-r", `${transportRef}@pi-subagents-transport`, "-T", 'commit_id ++ "\\t" ++ change_id'], root).then(parseIdentity);
  }

  async startAgent(request: { readonly name: string; readonly cwd: string; readonly argv: readonly string[]; readonly environment: NodeJS.ProcessEnv }): Promise<HerdrAgent> {
    const herdr = this.options.herdrExecutable ?? "herdr";
    const environmentArguments = Object.entries(request.environment)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .flatMap(([key, value]) => ["--env", `${key}=${value}`]);
    await command(herdr, ["agent", "start", request.name, "--cwd", request.cwd, "--no-focus", ...environmentArguments, "--", ...request.argv], request.cwd);
    const info = await this.getAgentInfo(request.name, request.cwd);
    return { name: info.agent, paneId: info.pane_id };
  }

  async waitForObservation(agent: HerdrAgent, phase: "startup" | "settlement"): Promise<HerdrObservation> {
    const timeout = phase === "startup" ? this.options.startupTimeoutMs ?? 30_000 : this.options.settlementTimeoutMs ?? 30 * 60_000;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const info = await this.getAgentInfo(agent.name, process.cwd());
      if (info.pane_id !== agent.paneId) throw new WorkerRuntimeError("Herdr agent identity was replaced");
      if (info.agent_status === "blocked") return "blocked";
      if (phase === "startup" && info.agent_status === "idle") return "ready";
      if (phase === "settlement" && (info.agent_status === "idle" || info.agent_status === "done")) return "settled";
      await sleep(250);
    }
    throw new WorkerRuntimeError(`Herdr ${phase} readiness timed out`);
  }

  async sendPrompt(agent: HerdrAgent, prompt: string): Promise<void> {
    await command(this.options.herdrExecutable ?? "herdr", ["agent", "send", agent.name, prompt], process.cwd());
  }

  private async getAgentInfo(name: string, cwd: string): Promise<AgentInfo> {
    return parseAgentInfo(await command(this.options.herdrExecutable ?? "herdr", ["agent", "get", name], cwd));
  }
}
