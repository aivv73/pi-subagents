import { describe, expect, it } from "vitest";

import { cancelAndRetain, cleanupIntegratedResources } from "./terminal-resources.js";
import type { RunJournal } from "../ports/journal.js";
import type { TerminalResourceRuntime } from "../ports/terminal-resources.js";

const journal = () => {
  const drafts: unknown[] = [];
  const value: RunJournal = { path: "/journal", runId: "run-1", append: async (draft) => { drafts.push(draft); return { eventId: `event-${drafts.length}` } as never; } };
  return { value, drafts };
};

describe("terminal resources", () => {
  it("requests cooperation, sends bounded Ctrl+C only when needed, and retains cancellation resources", async () => {
    const calls: string[] = [];
    let waits = 0;
    const runtime: TerminalResourceRuntime = {
      requestCooperativeStop: async (agent) => { calls.push(`ask:${agent.name}`); },
      waitForStop: async () => ++waits > 1,
      sendInterrupt: async (agent) => { calls.push(`interrupt:${agent.paneId}`); },
      deleteTransportRef: async () => undefined, closePane: async () => undefined, removeRift: async () => undefined, garbageCollectRifts: async () => undefined,
    };
    const events = journal();
    await expect(cancelAndRetain({ runId: "run-1", causationId: "cause", agents: [{ name: "worker", paneId: "pane-1" }], runtime, journal: events.value, timeoutMs: 1 }))
      .resolves.toEqual({ _tag: "cancelled_retained", unsettledAgents: [] });
    expect(calls).toEqual(["ask:worker", "interrupt:pane-1"]);
    expect(events.drafts.map((draft) => (draft as { payload: { _tag: string } }).payload._tag)).toEqual(["cancellation_requested", "run_cancelled"]);
  });

  it("continues idempotent cleanup and reports a warning without rollback when one step fails", async () => {
    const calls: string[] = [];
    const runtime: TerminalResourceRuntime = {
      requestCooperativeStop: async () => undefined, waitForStop: async () => true, sendInterrupt: async () => undefined,
      deleteTransportRef: async () => { calls.push("ref"); }, closePane: async () => { calls.push("pane"); throw new Error("busy"); },
      removeRift: async (rift) => { calls.push(`rift:${rift.id}`); }, garbageCollectRifts: async () => { calls.push("gc"); },
    };
    const events = journal();
    const result = await cleanupIntegratedResources({ runId: "run-1", causationId: "cause", runtime, journal: events.value, resources: { sourceRoot: "/source", stateDirectory: "/state", transportRef: "pi-subagents/run/task/attempt", transportCommitId: "commit", agents: [{ name: "worker", paneId: "pane" }], rifts: [{ id: "worker", root: "/rift/worker" }] } });
    expect(result).toMatchObject({ _tag: "succeeded_with_cleanup_warning", warnings: [expect.stringContaining("busy")] });
    expect(calls).toEqual(["ref", "pane", "rift:worker", "gc"]);
    expect(events.drafts.at(-1)).toMatchObject({ payload: { _tag: "cleanup_failed" } });
  });
});
