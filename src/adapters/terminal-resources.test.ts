import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NodeTerminalResourceRuntime, TerminalResourceError } from "./terminal-resources.js";

describe("NodeTerminalResourceRuntime", () => {
  it("uses fixed cooperative/interrupt/close/Rift argv and refuses source-root removal", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-subagents-terminal-"));
    const executable = join(root, "fake.mjs");
    const log = join(root, "log");
    const source = join(root, "source");
    const rift = join(root, "rift");
    try {
      await mkdir(source); await mkdir(rift);
      await writeFile(executable, `#!/usr/bin/env node\nimport { appendFileSync } from 'node:fs'; appendFileSync(process.env.LOG, JSON.stringify(process.argv.slice(2))+'\\n');`);
      await chmod(executable, 0o755);
      const previous = process.env.LOG; process.env.LOG = log;
      try {
        const runtime = new NodeTerminalResourceRuntime({ herdrExecutable: executable, riftExecutable: executable });
        const agent = { name: "worker", paneId: "pane-1" };
        await runtime.requestCooperativeStop(agent);
        await runtime.sendInterrupt(agent);
        await runtime.closePane(agent);
        await runtime.removeRift({ id: "worker", root: rift }, source);
        await expect(runtime.removeRift({ id: "source", root: source }, source)).rejects.toBeInstanceOf(TerminalResourceError);
        const commands = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
        expect(commands).toEqual(expect.arrayContaining([
          ["agent", "send", "worker", "Please stop now; the coordinator is cancelling this run."],
          ["pane", "send-keys", "pane-1", "C-c"], ["pane", "close", "pane-1"], ["remove", rift],
        ]));
      } finally { if (previous === undefined) delete process.env.LOG; else process.env.LOG = previous; }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
