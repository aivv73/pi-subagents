import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

      // Do not create state or external resources until preflight exists (#4).
      context.ui.notify(
        `Subagent run accepted for “${invocation.task}”, but orchestration is not implemented yet.`,
        "info",
      );
    },
  });
}
