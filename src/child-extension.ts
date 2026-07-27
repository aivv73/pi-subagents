import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { artifactsForChildConfig, writeResultAtomically } from "./adapters/artifacts.js";
import { GuardDeniedError, GuardedFilesystem } from "./adapters/guarded-filesystem.js";
import { decodeChildGuardConfig, type ChildGuardConfig } from "./domain/artifact-schema.js";

const result = (text: string, isError = false) => ({
  content: [{ type: "text" as const, text }],
  details: {},
  isError,
});

const guarded = async <A>(operation: () => Promise<A>, format: (value: A) => string) => {
  try {
    return result(format(await operation()));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return result(`Denied: ${message}`, true);
  }
};

const loadConfig = (): ChildGuardConfig => {
  const serialized = process.env.PI_SUBAGENTS_GUARD_CONFIG;
  if (serialized === undefined) throw new GuardDeniedError("missing coordinator child guard configuration");
  try {
    const config = decodeChildGuardConfig(JSON.parse(serialized) as unknown);
    if (
      !Number.isInteger(config.maxReadBytes) || config.maxReadBytes <= 0 ||
      !Number.isInteger(config.maxOutputBytes) || config.maxOutputBytes <= 0 ||
      config.role !== config.envelope.role || config.root !== config.envelope.root ||
      (config.role === "reviewer" && (config.reviewedCommitId === undefined || config.reviewedBaseCommitId === undefined)) ||
      (config.role === "reviewer" && config.reviewedBaseCommitId !== config.envelope.assignedBaseCommitId) ||
      (config.role === "worker" && (config.reviewedCommitId !== undefined || config.reviewedBaseCommitId !== undefined))
    ) {
      throw new Error("invalid role, root, or size policy");
    }
    return config;
  } catch (error) {
    throw new GuardDeniedError(`invalid coordinator child guard configuration: ${String(error)}`);
  }
};

/** Gives the child the coordinator-owned fields it must echo without exposing its artifact files. */
const resultInstruction = (config: ChildGuardConfig): string => {
  const shared = {
    schemaVersion: 1,
    runId: config.envelope.runId,
    taskId: config.envelope.taskId,
    attemptId: config.envelope.attemptId,
  };
  const template = config.role === "worker"
    ? { _tag: "worker", ...shared, changeId: "<current change ID>", commitId: "<current commit ID>", changedPaths: ["<each changed declared path>"] }
    : { _tag: "reviewer", ...shared, commitId: config.reviewedCommitId, assignedBaseCommitId: config.reviewedBaseCommitId, decision: "approved or revision_requested", findings: "findings" };
  return `Atomically write one strict result JSON object. Echo every fixed coordinator field exactly; replace only angle-bracket fields or the reviewer decision/findings: ${JSON.stringify(template)}`;
};

/** Explicit child-only extension. It registers no shell, network, environment, or arbitrary-process tool. */
export default function childExtension(pi: ExtensionAPI): void {
  const config = loadConfig();
  const filesystem = GuardedFilesystem.create(config);
  const artifacts = artifactsForChildConfig(config);
  const runtime = async () => ({ filesystem: await filesystem, artifacts: await artifacts });

  pi.registerTool({
    name: "subagent_read",
    label: "Read contained file",
    description: "Read one regular non-protected file inside the assigned repository root.",
    parameters: Type.Object({ path: Type.String() }),
    async execute(_id, parameters) {
      return guarded(async () => (await runtime()).filesystem.read(parameters.path), (text) => text);
    },
  });
  pi.registerTool({
    name: "subagent_search",
    label: "Search contained files",
    description: "Search regular non-protected files inside the assigned repository root.",
    parameters: Type.Object({ query: Type.String(), maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
    async execute(_id, parameters) {
      return guarded(
        async () => (await runtime()).filesystem.search(parameters.query, parameters.maxResults ?? 50),
        (matches) => JSON.stringify(matches),
      );
    },
  });

  if (config.role === "worker") {
    pi.registerTool({
      name: "subagent_write",
      label: "Write declared task file",
      description: "Atomically replace one coordinator-declared task file.",
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      async execute(_id, parameters) {
        return guarded(async () => (await runtime()).filesystem.write(parameters.path, parameters.content), () => "Written.");
      },
    });
    pi.registerTool({
      name: "subagent_edit",
      label: "Edit declared task file",
      description: "Replace exactly one matching string in a coordinator-declared task file.",
      parameters: Type.Object({ path: Type.String(), oldText: Type.String(), newText: Type.String() }),
      async execute(_id, parameters) {
        return guarded(
          async () => (await runtime()).filesystem.edit(parameters.path, parameters.oldText, parameters.newText),
          () => "Edited.",
        );
      },
    });
    pi.registerTool({
      name: "subagent_jj_identity",
      label: "Inspect current Jujutsu identity",
      description: "Read the current task change and commit identity.",
      parameters: Type.Object({}),
      async execute() {
        return guarded(async () => (await runtime()).filesystem.jjIdentity(), (identity) => identity);
      },
    });
    pi.registerTool({
      name: "subagent_jj_describe",
      label: "Describe current Jujutsu change",
      description: "Set the description on the current assigned task change only.",
      parameters: Type.Object({ description: Type.String({ maxLength: 240 }) }),
      async execute(_id, parameters) {
        return guarded(async () => (await runtime()).filesystem.jjDescribe(parameters.description), (output) => output || "Described.");
      },
    });
  } else {
    pi.registerTool({
      name: "subagent_jj_diff",
      label: "Inspect Jujutsu diff",
      description: "Read the assigned repository diff without running project commands.",
      parameters: Type.Object({}),
      async execute() {
        return guarded(async () => (await runtime()).filesystem.jjDiff(), (diff) => diff);
      },
    });
  }

  pi.registerTool({
    name: "subagent_write_result",
    label: "Write structured result",
    description: resultInstruction(config),
    parameters: Type.Object({ json: Type.String({ maxLength: 65536 }) }),
    async execute(_id, parameters) {
      return guarded(
        async () => writeResultAtomically(await artifacts, parameters.json, config.maxOutputBytes),
        () => "Result written.",
      );
    },
  });
}
