import { describe, expect, it } from "vitest";

import { parseRunInvocation } from "./command.js";

describe("parseRunInvocation", () => {
  it("rejects non-TUI use before parsing a task", () => {
    expect(parseRunInvocation("rpc", "run update a file")).toMatchObject({
      _tag: "Rejected",
      message: expect.stringContaining("interactive TUI"),
    });
  });

  it("rejects an empty run task", () => {
    expect(parseRunInvocation("tui", "run   ")).toMatchObject({
      _tag: "Rejected",
      message: expect.stringContaining("non-empty task"),
    });
  });

  it("requires the run subcommand", () => {
    expect(parseRunInvocation("tui", "status")).toMatchObject({
      _tag: "Rejected",
      message: "Usage: /subagents run --paths path[,path...] [--paths path[,path...]] <task>",
    });
  });

  it("accepts repeatable scope declarations and deduplicates paths without side effects", () => {
    expect(parseRunInvocation("tui", " run --paths README.md,src/a.ts --paths src/a.ts update README ")).toEqual({
      _tag: "Accepted",
      task: "update README",
      allowedTrackedPaths: ["README.md", "src/a.ts"],
    });
  });

  it.each([
    ["missing scope", "run update README", "At least one --paths"],
    ["empty value", "run --paths README.md, update README", "must not contain an empty"],
    ["missing value", "run --paths --unknown update README", "requires a non-empty"],
    ["unknown option", "run --unknown update README", "Unsupported option"],
  ])("rejects %s", (_name, input, message) => {
    expect(parseRunInvocation("tui", input)).toMatchObject({ _tag: "Rejected", message: expect.stringContaining(message) });
  });
});
