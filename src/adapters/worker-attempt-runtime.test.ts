import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NodeWorkerAttemptRuntime } from "./worker-attempt-runtime.js";

const withFakeExecutable = async (test: (executable: string, logPath: string, root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "pi-subagents-worker-runtime-"));
  const executable = join(root, "fake-runtime.mjs");
  const logPath = join(root, "commands.jsonl");
  await writeFile(executable, `#!/usr/bin/env node
import { appendFileSync, mkdirSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.LOG_PATH, JSON.stringify(args) + '\\n');
if (args[0] === 'create') mkdirSync(args[args.indexOf('--into') + 1], { recursive: true });
if (args[1] === 'get') process.stdout.write(JSON.stringify({ result: { agent: { agent: args[2], pane_id: 'pane-1', agent_status: 'idle' } } }));
`);
  await chmod(executable, 0o755);
  const previous = process.env.LOG_PATH;
  process.env.LOG_PATH = logPath;
  try {
    await test(executable, logPath, root);
  } finally {
    if (previous === undefined) delete process.env.LOG_PATH;
    else process.env.LOG_PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
};

describe("NodeWorkerAttemptRuntime", () => {
  it("creates an exact no-hooks Rift snapshot and never issues source removal", async () => {
    await withFakeExecutable(async (executable, logPath, root) => {
      const source = join(root, "source");
      const destination = join(root, "destination");
      await mkdir(source);
      const runtime = new NodeWorkerAttemptRuntime({ riftExecutable: executable });
      const snapshot = await runtime.createExactSnapshot({ sourceRoot: source, destination, name: "worker-1" });
      const commands = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);

      expect(snapshot).toMatchObject({ id: "worker-1", root: destination });
      expect(commands).toEqual([
        ["init", source],
        ["create", source, "--into", destination, "--name", "worker-1", "--copy-all", "--no-hooks"],
      ]);
      expect(commands.flat()).not.toContain("remove");
    });
  });

  it("starts a named Herdr agent with only supplied environment entries and captures its pane identity", async () => {
    await withFakeExecutable(async (executable, logPath, root) => {
      const runtime = new NodeWorkerAttemptRuntime({ herdrExecutable: executable });
      const agent = await runtime.startAgent({
        name: "worker-1",
        cwd: root,
        argv: ["pi", "--no-builtin-tools"],
        environment: { PATH: "/bin", PI_SUBAGENTS_GUARD_CONFIG: "{}" },
      });
      const commands = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);

      expect(agent).toEqual({ name: "worker-1", paneId: "pane-1" });
      expect(commands[0]).toEqual(expect.arrayContaining(["agent", "start", "worker-1", "--env", "PATH=/bin", "--env", "PI_SUBAGENTS_GUARD_CONFIG={}"]));
      expect(commands[0]).toEqual(expect.arrayContaining(["--", "pi", "--no-builtin-tools"]));
      expect(commands[1]).toEqual(["agent", "get", "worker-1"]);
    });
  });
});
