import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { nodePreflightEnvironment } from "./adapters/node-preflight.js";
import { runPreflight } from "./application/preflight.js";
import { parseRunInvocation } from "./command.js";

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
        context.ui.notify(`Preflight failed: ${preflight.issues.map((entry) => entry.message).join(" ")}`, "error");
        return;
      }

      // Do not create state or external resources until the worker flow exists (#5).
      context.ui.notify(
        `Preflight passed for “${invocation.task}”, but worker orchestration is not implemented yet.`,
        "info",
      );
    },
  });
}
