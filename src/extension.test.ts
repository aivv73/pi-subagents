import { describe, expect, it } from "vitest";

import { createPiSubagentsExtension, type ExtensionDependencies } from "./extension.js";

type Command = { readonly name: string; readonly handler: (argumentsText: string, context: any) => Promise<void>; };
const passed = {
  _tag: "preflight_passed" as const,
  evidence: { sourceRoot: "/source", stateDirectory: "/state", assignedBaseCommitId: "base", assignedBaseChangeId: "base-change", repositoryId: "repo", piVersion: "pi", nodeVersion: "node", herdrVersion: "herdr", herdrProtocol: 1, herdrSchemaVersion: 1, riftHelp: "rift", jjVersion: "jj", gitVersion: "git" },
};

const context = (ui: { notify(message: string, type?: string): void; setWidget(key: string, lines: string[]): void }) => ({
  mode: "tui", cwd: "/source", ui, model: { id: "model" }, isProjectTrusted: () => true,
  modelRegistry: { hasConfiguredAuth: () => true },
});

const register = (dependencies?: Partial<ExtensionDependencies>) => {
  const commands: Command[] = [];
  const entries: unknown[] = [];
  const base: ExtensionDependencies = {
    preflight: (async () => passed) as ExtensionDependencies["preflight"],
    admission: (async (input) => ({ _tag: "admitted" as const, allowedTrackedPaths: input.allowedTrackedPaths })) as ExtensionDependencies["admission"],
    preflightEnvironment: {} as ExtensionDependencies["preflightEnvironment"],
    admissionRuntime: {} as ExtensionDependencies["admissionRuntime"],
    supervisor: () => ({ start: async () => ({ _tag: "start_failed" as const, reason: "test has no supervisor" }) }),
  };
  createPiSubagentsExtension({
    registerCommand(name: string, command: Command) { commands.push({ name, handler: command.handler }); },
    appendEntry(_type: string, data: unknown) { entries.push(data); },
  } as never, { ...base, ...dependencies });
  return { commands, entries };
};

describe("Pi extension entry point", () => {
  it("registers the /subagents command", () => {
    expect(register().commands.map((command) => command.name)).toEqual(["subagents"]);
  });

  it("rejects non-TUI invocation without starting work", async () => {
    const [command] = register().commands;
    const notifications: Array<{ message: string; type: string | undefined }> = [];
    await command!.handler("run update README", { mode: "print", ui: { notify: (message: string, type?: string) => notifications.push({ message, type }) } });
    expect(notifications).toEqual([expect.objectContaining({ type: "error", message: expect.stringContaining("interactive TUI") })]);
  });

  it("starts in the background, renders terminal success, and writes one sanitized entry", async () => {
    let settle!: (value: any) => void;
    const completion = new Promise((resolve) => { settle = resolve; });
    const { commands, entries } = register({ supervisor: () => ({ start: async () => ({ _tag: "started" as const, runId: "run-1", completion, cancel: async () => ({ _tag: "cancelled" as const }) }) }) });
    const notifications: Array<{ message: string; type: string | undefined }> = [];
    const widgets: string[][] = [];
    await commands[0]!.handler("run --paths README.md update README", context({
      notify: (message: string, type?: string) => notifications.push({ message, type }), setWidget: (_key, lines) => widgets.push(lines),
    }));
    expect(notifications).toContainEqual(expect.objectContaining({ type: "info", message: expect.stringContaining("run-1") }));
    expect(widgets.at(-1)).toEqual(expect.arrayContaining([expect.stringContaining("Worker running")]));
    settle({ _tag: "succeeded", approvedCommitId: "commit-1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(entries).toEqual([{ runId: "run-1", disposition: "succeeded", integratedCommitId: "commit-1", retainedResourceIds: [] }]);
    expect(widgets.at(-1)).toEqual(expect.arrayContaining([expect.stringContaining("Succeeded"), expect.stringContaining("Integrated: commit-1")]));
  });

  it("cancels only the active run and reports absence after terminal release", async () => {
    let settle!: (value: any) => void;
    const completion = new Promise((resolve) => { settle = resolve; });
    let cancels = 0;
    const { commands } = register({ supervisor: () => ({ start: async () => ({ _tag: "started" as const, runId: "run-1", completion, cancel: async () => { cancels += 1; return { _tag: "cancelled" as const }; } }) }) });
    const notifications: Array<{ message: string; type: string | undefined }> = [];
    const widgets: string[][] = [];
    const ui = { notify: (message: string, type?: string) => notifications.push({ message, type }), setWidget: (_key: string, lines: string[]) => widgets.push(lines) };
    await commands[0]!.handler("run --paths README.md update README", context(ui));
    await commands[0]!.handler("cancel", context(ui));
    expect(cancels).toBe(1);
    expect(widgets.at(-1)).toEqual(expect.arrayContaining([expect.stringContaining("Cancellation requested")]));
    settle({ _tag: "cancelled", retained: { agents: [], rifts: [], stateDirectory: "/state", sourceRoot: "/source", transportRef: undefined, transportCommitId: undefined } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await commands[0]!.handler("cancel", context(ui));
    expect(notifications).toContainEqual(expect.objectContaining({ message: expect.stringContaining("No active") }));
  });

  it("reports a competing active run and turns an unexpected background rejection into one terminal entry", async () => {
    let calls = 0;
    const { commands, entries } = register({ supervisor: () => ({ start: async () => {
      calls += 1;
      if (calls === 1) return { _tag: "started" as const, runId: "run-1", completion: Promise.reject(new Error("unexpected")), cancel: async () => ({ _tag: "cancelled" as const }) };
      return { _tag: "already_active" as const, runId: "run-1" };
    } }) });
    const notifications: Array<{ message: string; type: string | undefined }> = [];
    const ui = { notify: (message: string, type?: string) => notifications.push({ message, type }), setWidget: () => {} };
    await commands[0]!.handler("run --paths README.md update README", context(ui));
    await commands[0]!.handler("run --paths README.md update README", context(ui));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notifications).toContainEqual(expect.objectContaining({ type: "warning", message: expect.stringContaining("already active") }));
    expect(entries).toEqual([{ runId: "run-1", disposition: "failed", retainedResourceIds: [] }]);
  });
});
