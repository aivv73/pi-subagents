import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { NodeDirectTaskAdmissionRuntime } from "./adapters/direct-task-admission.js";
import { NodeIntegrationRuntime } from "./adapters/integration-runtime.js";
import { JsonlJournal } from "./adapters/jsonl-journal.js";
import { LocalGitTransport } from "./adapters/local-git-transport.js";
import { nodePreflightEnvironment } from "./adapters/node-preflight.js";
import { NodeTerminalResourceRuntime } from "./adapters/terminal-resources.js";
import { NodeWorkerAttemptRuntime } from "./adapters/worker-attempt-runtime.js";
import { admitDirectTask } from "./application/direct-task-admission.js";
import { DirectRunSupervisor, type DirectRunRequest } from "./application/direct-run-supervisor.js";
import { runPreflight } from "./application/preflight.js";
import { progressNotification, progressWidget, type SemanticProgress } from "./application/progress.js";
import { SingleRunRegistry } from "./application/run-registry.js";
import { terminalProgress, terminalSummary } from "./application/terminal-summary.js";
import { parseRunInvocation } from "./command.js";

const extensionDirectory = dirname(fileURLToPath(import.meta.url));
const packageAsset = (name: string): string => join(extensionDirectory, "..", name);

type StartableSupervisor = Pick<DirectRunSupervisor, "start">;
export interface ExtensionDependencies {
  readonly preflight: typeof runPreflight;
  readonly admission: typeof admitDirectTask;
  readonly preflightEnvironment: ReturnType<typeof nodePreflightEnvironment>;
  readonly admissionRuntime: NodeDirectTaskAdmissionRuntime;
  readonly supervisor: (stateDirectory: string) => StartableSupervisor;
}

const defaultDependencies = (): ExtensionDependencies => {
  const registry = new SingleRunRegistry();
  return {
    preflight: runPreflight,
    admission: admitDirectTask,
    preflightEnvironment: nodePreflightEnvironment(),
    admissionRuntime: new NodeDirectTaskAdmissionRuntime(),
    supervisor: (stateDirectory) => {
      const attempts = new NodeWorkerAttemptRuntime();
      return new DirectRunSupervisor({
        ids: { next: () => randomUUID() },
        journals: { open: JsonlJournal.open },
        snapshots: {
          destination: (role, attemptId) => join(stateDirectory, "rifts", `${role}-${attemptId}`),
          name: (role, attemptId) => `pi-subagents-${role}-${attemptId}`,
        },
        registry,
        workerRuntime: attempts,
        reviewerRuntime: attempts,
        transport: new LocalGitTransport(),
        integrationRuntime: new NodeIntegrationRuntime(),
        terminalRuntime: new NodeTerminalResourceRuntime(),
      });
    },
  };
};

const detail = (progress: SemanticProgress): string | undefined => progress.detail;

/** The trusted Pi boundary owns command dispatch and rendering, never orchestration policy. */
export function createPiSubagentsExtension(pi: ExtensionAPI, dependencies: ExtensionDependencies = defaultDependencies()): void {
  let active: { readonly runId: string; readonly cancel: () => Promise<{ readonly _tag: "cancelled" } | { readonly _tag: "too_late" }> } | undefined;
  const render = (ui: { setWidget(key: string, lines: string[] | undefined): void; notify(message: string, type?: "info" | "warning" | "error"): void }, progress: SemanticProgress, notify = false): void => {
    ui.setWidget("pi-subagents", progressWidget(progress));
    const notification = progressNotification(progress);
    if (notify && notification !== undefined) ui.notify(notification.message, notification.type);
  };

  pi.registerCommand("subagents", {
    description: "Run an isolated, reviewer-controlled subagent task",
    handler: async (argumentsText, context) => {
      if (argumentsText.trim() === "cancel") {
        if (active === undefined) {
          context.ui.notify("No active subagent run to cancel.", "info");
          return;
        }
        render(context.ui, { phase: "cancelling", detail: `Cancellation requested for ${active.runId}.` });
        const cancellation = await active.cancel();
        if (cancellation._tag === "too_late") context.ui.notify(`Run ${active.runId} is already integrating or cleaning and cannot be cancelled.`, "warning");
        return;
      }

      const invocation = parseRunInvocation(context.mode, argumentsText);
      if (invocation._tag === "Rejected") {
        context.ui.notify(invocation.message, "error");
        return;
      }
      const preflight = await dependencies.preflight({
        mode: context.mode,
        projectTrusted: context.isProjectTrusted(),
        task: invocation.task,
        parentModelAuthenticated: context.model !== undefined && context.modelRegistry.hasConfiguredAuth(context.model),
        cwd: context.cwd,
      }, dependencies.preflightEnvironment);
      if (preflight._tag === "preflight_failed") {
        render(context.ui, { phase: "failed", detail: "Preflight failed before resources were created." });
        context.ui.notify(`Preflight failed: ${preflight.issues.map((entry) => entry.message).join(" ")}`, "error");
        return;
      }
      const admission = await dependencies.admission({
        sourceRoot: preflight.evidence.sourceRoot, stateDirectory: preflight.evidence.stateDirectory, allowedTrackedPaths: invocation.allowedTrackedPaths,
      }, dependencies.admissionRuntime);
      if (admission._tag === "rejected") {
        render(context.ui, { phase: "blocked", detail: "Direct-task admission rejected before resources were created." });
        context.ui.notify(`Direct-task admission rejected: ${admission.reasons.join(" ")}`, "error");
        return;
      }
      const request: DirectRunRequest = {
        task: invocation.task, sourceRoot: preflight.evidence.sourceRoot, stateDirectory: preflight.evidence.stateDirectory,
        assignedBaseCommitId: preflight.evidence.assignedBaseCommitId, allowedTrackedPaths: admission.allowedTrackedPaths,
        childExtensionPath: join(extensionDirectory, "child-extension.js"), workerPromptPath: packageAsset("prompts/worker.md"), reviewerPromptPath: packageAsset("prompts/reviewer.md"),
        piExecutable: "pi", parentModel: context.model!.id, parentEnvironment: process.env,
        onProgress: (progress) => render(context.ui, progress),
      };
      const started = await dependencies.supervisor(preflight.evidence.stateDirectory).start(request);
      if (started._tag === "already_active") {
        context.ui.notify(`A subagent run is already active: ${started.runId}`, "warning");
        return;
      }
      if (started._tag === "start_failed") {
        render(context.ui, { phase: "failed", detail: "Run journal creation failed before dispatch." });
        context.ui.notify(`Subagent run could not start: ${started.reason}`, "error");
        return;
      }
      active = started;
      render(context.ui, { phase: "worker_running", detail: `Run ${started.runId} started.` });
      context.ui.notify(`Subagent run started: ${started.runId}`, "info");
      void started.completion.then((disposition) => {
        if (active?.runId === started.runId) active = undefined;
        const summary = terminalSummary(started.runId, disposition);
        const progress = terminalProgress(summary, disposition._tag === "failed" || disposition._tag === "blocked" ? disposition.reason : undefined);
        render(context.ui, progress, true);
        pi.appendEntry("pi-subagents-terminal", summary);
      }).catch((error: unknown) => {
        if (active?.runId === started.runId) active = undefined;
        const message = error instanceof Error ? error.message : String(error);
        render(context.ui, { phase: "failed", detail: "Background supervisor failed unexpectedly." });
        context.ui.notify(`Subagent run ${started.runId} failed unexpectedly: ${message}`, "error");
        pi.appendEntry("pi-subagents-terminal", { runId: started.runId, disposition: "failed", retainedResourceIds: [] });
      });
    },
  });
}

export default function piSubagentsExtension(pi: ExtensionAPI): void {
  createPiSubagentsExtension(pi);
}
