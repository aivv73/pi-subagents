import { describe, expect, it } from "vitest";

import { createPiSubagentsExtension, type ExtensionDependencies } from "./extension.js";
import type { DoctorReport } from "./domain/doctor-schema.js";

type Command = { readonly name: string; readonly handler: (argumentsText: string, context: any) => Promise<void>; };
const passed = {
  _tag: "preflight_passed" as const,
  evidence: { sourceRoot: "/source", stateDirectory: "/state", assignedBaseCommitId: "base", assignedBaseChangeId: "base-change", repositoryId: "repo", piVersion: "pi", nodeVersion: "node", herdrVersion: "herdr", herdrProtocol: 1, herdrSchemaVersion: 1, riftHelp: "rift", jjVersion: "jj", gitVersion: "git" },
};
const doctorPassed: DoctorReport = { schemaVersion: 1, status: "passed", checks: [{ id: "platform", status: "passed", evidence: "linux", issue: undefined }], issues: [], evidence: passed.evidence };

const context = (ui: { notify(message: string, type?: string): void; setWidget(key: string, lines: string[]): void }) => ({
  mode: "tui", cwd: "/source", ui, model: { id: "model" }, isProjectTrusted: () => true,
  modelRegistry: { hasConfiguredAuth: () => true },
});

const register = (dependencies?: Partial<ExtensionDependencies>) => {
  const commands: Command[] = [];
  const entries: unknown[] = [];
  const base: ExtensionDependencies = {
    doctor: (async () => doctorPassed) as ExtensionDependencies["doctor"],
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

  it("renders the shared doctor result without admitting or starting a run", async () => {
    let doctorCalls = 0;
    let admissionCalls = 0;
    let supervisorCalls = 0;
    const { commands } = register({
      doctor: (async () => { doctorCalls += 1; return doctorPassed; }) as ExtensionDependencies["doctor"],
      admission: (async () => { admissionCalls += 1; return { _tag: "rejected" as const, reasons: [] }; }) as ExtensionDependencies["admission"],
      supervisor: () => { supervisorCalls += 1; return { start: async () => ({ _tag: "start_failed" as const, reason: "must not start" }) }; },
    });
    const notifications: Array<{ message: string; type: string | undefined }> = [];
    const ui = { notify: (message: string, type?: string) => notifications.push({ message, type }), setWidget: () => {} };
    await commands[0]!.handler("doctor", { ...context(ui), model: undefined, modelRegistry: { hasConfiguredAuth: () => { throw new Error("doctor must not inspect model authentication"); } } });
    expect(doctorCalls).toBe(1);
    expect(admissionCalls).toBe(0);
    expect(supervisorCalls).toBe(0);
    expect(notifications).toEqual([{ message: "Subagents doctor passed (1 checks).", type: "info" }]);
  });

  it("requires TUI trust before doctor probes and bounds failed diagnostics to safe remediation", async () => {
    let doctorCalls = 0;
    const failed: DoctorReport = {
      ...doctorPassed,
      status: "failed",
      evidence: undefined,
      issues: [
        { code: "command_unavailable", message: "untrusted raw command output", remediation: "Install Rift." },
        { code: "unsupported_filesystem", message: "untrusted raw filesystem output", remediation: "Use btrfs." },
        { code: "assigned_base_mutable", message: "untrusted raw base output", remediation: "Make the base immutable." },
        { code: "working_copy_not_empty", message: "untrusted fourth output", remediation: "Clear the working copy." },
      ],
      checks: [],
    };
    const { commands } = register({ doctor: (async () => { doctorCalls += 1; return failed; }) as ExtensionDependencies["doctor"] });
    const notifications: Array<{ message: string; type: string | undefined }> = [];
    const ui = { notify: (message: string, type?: string) => notifications.push({ message, type }), setWidget: () => {} };
    await commands[0]!.handler("doctor", { ...context(ui), isProjectTrusted: () => false });
    await commands[0]!.handler("doctor", { ...context(ui), mode: "print" });
    expect(doctorCalls).toBe(0);
    expect(notifications).toEqual([
      { message: "Trust this project before running /subagents doctor.", type: "warning" },
      { message: "/subagents doctor is available only in Pi's interactive TUI.", type: "error" },
    ]);

    await commands[0]!.handler("doctor", context(ui));
    expect(doctorCalls).toBe(1);
    expect(notifications.at(-1)).toEqual(expect.objectContaining({ type: "error", message: expect.stringContaining("command_unavailable: Install Rift. unsupported_filesystem: Use btrfs. assigned_base_mutable: Make the base immutable.") }));
    expect(notifications.at(-1)?.message).not.toContain("untrusted raw");
    expect(notifications.at(-1)?.message).not.toContain("Clear the working copy.");
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
