/**
 * The command surface deliberately has no orchestration dependencies yet.
 * See ARCH-pi-subagents and REQ-external-runtime-distribution.
 */
export type RunInvocation =
  | { readonly _tag: "Rejected"; readonly message: string }
  | { readonly _tag: "Accepted"; readonly task: string; readonly allowedTrackedPaths: readonly string[] };

export type PiMode = "tui" | "rpc" | "json" | "print";

export const parseRunInvocation = (mode: PiMode, argumentsText: string): RunInvocation => {
  if (mode !== "tui") {
    return {
      _tag: "Rejected",
      message: "/subagents run is available only in Pi's interactive TUI.",
    };
  }

  const words = argumentsText.trim().split(/\s+/);
  const [command, ...arguments_] = words;
  if (command !== "run") {
    return {
      _tag: "Rejected",
      message: "Usage: /subagents run --paths path[,path...] [--paths path[,path...]] <task>",
    };
  }
  if (arguments_.length === 0) {
    return { _tag: "Rejected", message: "A non-empty task is required. Usage: /subagents run --paths path <task>" };
  }

  const paths: string[] = [];
  let offset = 0;
  while (arguments_[offset] === "--paths") {
    const value = arguments_[offset + 1];
    if (value === undefined || value.startsWith("--")) {
      return { _tag: "Rejected", message: "Each --paths flag requires a non-empty comma-separated value." };
    }
    const entries = value.split(",");
    if (entries.some((entry) => entry.trim() === "")) {
      return { _tag: "Rejected", message: "--paths must not contain an empty path." };
    }
    paths.push(...entries.map((entry) => entry.trim()));
    offset += 2;
  }
  if (arguments_[offset]?.startsWith("--")) {
    return { _tag: "Rejected", message: `Unsupported option: ${arguments_[offset]}` };
  }
  const task = arguments_.slice(offset).join(" ").trim();
  if (task.length === 0) {
    return {
      _tag: "Rejected",
      message: "A non-empty task is required. Usage: /subagents run --paths path <task>",
    };
  }
  if (paths.length === 0) {
    return { _tag: "Rejected", message: "At least one --paths declaration is required." };
  }

  return { _tag: "Accepted", task, allowedTrackedPaths: [...new Set(paths)] };
};
