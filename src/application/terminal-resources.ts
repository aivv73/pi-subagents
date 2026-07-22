import type { RunJournal } from "../ports/journal.js";
import type { RetainedAgent, TerminalResourceRuntime, TerminalResources } from "../ports/terminal-resources.js";

export type CancellationResult = { readonly _tag: "cancelled_retained"; readonly unsettledAgents: readonly RetainedAgent[] };
export type CleanupResult = { readonly _tag: "succeeded" } | { readonly _tag: "succeeded_with_cleanup_warning"; readonly warnings: readonly string[] };

/** Cancellation never disposes uncertain resources or permits further integration. */
export const cancelAndRetain = async (input: {
  readonly runId: string; readonly causationId: string; readonly agents: readonly RetainedAgent[]; readonly runtime: TerminalResourceRuntime; readonly journal: RunJournal; readonly timeoutMs?: number;
}): Promise<CancellationResult> => {
  const timeoutMs = input.timeoutMs ?? 2_000;
  await input.journal.append({ causationId: input.causationId, correlationId: input.runId, payload: { _tag: "cancellation_requested" } });
  const unsettled: RetainedAgent[] = [];
  for (const agent of input.agents) {
    try {
      await input.runtime.requestCooperativeStop(agent);
      if (!(await input.runtime.waitForStop(agent, timeoutMs))) {
        await input.runtime.sendInterrupt(agent);
        if (!(await input.runtime.waitForStop(agent, timeoutMs))) unsettled.push(agent);
      }
    } catch {
      unsettled.push(agent);
    }
  }
  await input.journal.append({ causationId: input.causationId, correlationId: input.runId, payload: { _tag: "run_cancelled" } });
  return { _tag: "cancelled_retained", unsettledAgents: unsettled };
};

/** Runs only after verified integration. Every cleanup step is idempotent and independent. */
export const cleanupIntegratedResources = async (input: {
  readonly runId: string; readonly causationId: string; readonly resources: TerminalResources; readonly runtime: TerminalResourceRuntime; readonly journal: RunJournal;
}): Promise<CleanupResult> => {
  const warnings: string[] = [];
  const step = async (name: string, operation: () => Promise<void>): Promise<void> => {
    try { await operation(); } catch (error) { warnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
  };
  if (input.resources.transportRef !== undefined && input.resources.transportCommitId !== undefined) {
    await step("transport ref", () => input.runtime.deleteTransportRef(input.resources.stateDirectory, input.resources.transportRef!, input.resources.transportCommitId!));
  }
  for (const agent of input.resources.agents) await step(`Herdr pane ${agent.paneId}`, () => input.runtime.closePane(agent));
  for (const rift of input.resources.rifts) await step(`Rift ${rift.id}`, () => input.runtime.removeRift(rift, input.resources.sourceRoot));
  await step("Rift garbage collection", () => input.runtime.garbageCollectRifts());
  if (warnings.length === 0) {
    await input.journal.append({ causationId: input.causationId, correlationId: input.runId, payload: { _tag: "cleanup_succeeded" } });
    return { _tag: "succeeded" };
  }
  await input.journal.append({ causationId: input.causationId, correlationId: input.runId, payload: { _tag: "cleanup_failed", reason: warnings.join("; ") } });
  return { _tag: "succeeded_with_cleanup_warning", warnings };
};
