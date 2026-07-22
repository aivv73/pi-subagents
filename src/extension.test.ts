import { describe, expect, it } from "vitest";

import extension from "./extension.js";

type Command = {
  readonly name: string;
  readonly description: string;
  readonly handler: (argumentsText: string, context: {
    readonly mode: "tui" | "rpc" | "json" | "print";
    readonly ui: { notify(message: string, type?: "info" | "warning" | "error"): void; setWidget?(key: string, lines: readonly string[]): void };
  }) => Promise<void>;
};

const register = (): Command[] => {
  const commands: Command[] = [];
  extension({
    registerCommand(name: string, command: Omit<Command, "name">) {
      commands.push({ name, ...command });
    },
  } as never);
  return commands;
};

describe("Pi extension entry point", () => {
  it("registers exactly the /subagents command", () => {
    expect(register()).toMatchObject([
      {
        name: "subagents",
        description: expect.stringContaining("reviewer-controlled"),
      },
    ]);
  });

  it("rejects non-TUI invocation without starting work", async () => {
    const [command] = register();
    const notifications: Array<{ message: string; type: string | undefined }> = [];

    await command.handler("run update README", {
      mode: "print",
      ui: { notify: (message, type) => notifications.push({ message, type }) },
    });

    expect(notifications).toEqual([
      expect.objectContaining({ type: "error", message: expect.stringContaining("interactive TUI") }),
    ]);
  });
});
