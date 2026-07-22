/**
 * The command surface deliberately has no orchestration dependencies yet.
 * See ARCH-pi-subagents and REQ-external-runtime-distribution.
 */
export type RunInvocation =
  | { readonly _tag: "Rejected"; readonly message: string }
  | { readonly _tag: "Accepted"; readonly task: string };

export type PiMode = "tui" | "rpc" | "json" | "print";

export const parseRunInvocation = (mode: PiMode, argumentsText: string): RunInvocation => {
  if (mode !== "tui") {
    return {
      _tag: "Rejected",
      message: "/subagents run is available only in Pi's interactive TUI.",
    };
  }

  const [command, ...taskWords] = argumentsText.trim().split(/\s+/);
  if (command !== "run") {
    return {
      _tag: "Rejected",
      message: "Usage: /subagents run <task>",
    };
  }

  const task = taskWords.join(" ").trim();
  if (task.length === 0) {
    return {
      _tag: "Rejected",
      message: "A non-empty task is required. Usage: /subagents run <task>",
    };
  }

  return { _tag: "Accepted", task };
};
