import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { nodePreflightEnvironment } from "./adapters/node-preflight.js";
import { NodeDirectTaskAdmissionRuntime } from "./adapters/direct-task-admission.js";
import { admitDirectTask } from "./application/direct-task-admission.js";
import { runPreflight } from "./application/preflight.js";
import { parseRunInvocation } from "./command.js";
import { progressWidget } from "./application/progress.js";

/** Pi package entry point. Orchestration begins in later first-slice tickets. */
export default function piSubagentsExtension(pi: ExtensionAPI): void {
  pi.registerCommand("subagents", {
    description: "Run an isolated, reviewer-controlled subagent task",
    handler: async (argumentsText, context) => {
      const invocation = parseRunInvocation(context.mode, argumentsText);

      if (invocation._tag === "Rejected") {
        context.ui.notify(invocation.message, "error");
        return;
      }

      const preflight = await runPreflight(
        {
          mode: context.mode,
          projectTrusted: context.isProjectTrusted(),
          task: invocation.task,
          parentModelAuthenticated:
            context.model !== undefined && context.modelRegistry.hasConfiguredAuth(context.model),
          cwd: context.cwd,
        },
        nodePreflightEnvironment(),
      );
      if (preflight._tag === "preflight_failed") {
        context.ui.setWidget?.("pi-subagents", progressWidget({ phase: "failed", detail: "Preflight failed before resources were created." }));
        context.ui.notify(`Preflight failed: ${preflight.issues.map((entry) => entry.message).join(" ")}`, "error");
        return;
      }

      const admission = await admitDirectTask({
        sourceRoot: preflight.evidence.sourceRoot,
        stateDirectory: preflight.evidence.stateDirectory,
        allowedTrackedPaths: invocation.allowedTrackedPaths,
      }, new NodeDirectTaskAdmissionRuntime());
      if (admission._tag === "rejected") {
        context.ui.setWidget?.("pi-subagents", progressWidget({ phase: "blocked", detail: "Direct-task admission rejected before resources were created." }));
        context.ui.notify(`Direct-task admission rejected: ${admission.reasons.join(" ")}`, "error");
        return;
      }

      // The public coordinator binding is intentionally deferred; do not misrepresent a passed
      // preflight or a Herdr lifecycle label as worker validation, review, or integration.
      context.ui.setWidget?.("pi-subagents", progressWidget({ phase: "preflight", detail: "Preflight and direct-task admission passed; coordinator dispatch is not yet bound to this command." }));
      context.ui.notify(
        `Preflight passed for “${invocation.task}”, but worker orchestration is not implemented yet.`,
        "info",
      );
    },
  });
}
