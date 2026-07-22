import { describe, expect, it } from "vitest";
import { admitDirectTask } from "./direct-task-admission.js";
import type { DirectTaskAdmissionRuntime } from "../ports/direct-task-admission.js";

const runtime = (overrides: Partial<DirectTaskAdmissionRuntime> = {}): DirectTaskAdmissionRuntime => ({
  inspectSource: async () => ({ changedPaths: [], isConflicted: false }),
  inspectDeclaredPath: async (_root, path) => ({ path, kind: "regular_file" }),
  findRetainedRunIds: async () => [],
  ...overrides,
});
const input = { sourceRoot: "/source", stateDirectory: "/state", allowedTrackedPaths: ["README.md", "src/new.ts", "README.md"] };

describe("direct task admission", () => {
  it("admits normalized declared files and deduplicates them", async () => {
    await expect(admitDirectTask(input, runtime())).resolves.toEqual({ _tag: "admitted", allowedTrackedPaths: ["README.md", "src/new.ts"] });
  });
  it.each(["../escape", "/etc/passwd", ".git/config", ".env", "src/../x.ts", "src//x.ts"])("rejects unsafe lexical path %s", async (path) => {
    const result = await admitDirectTask({ ...input, allowedTrackedPaths: [path] }, runtime());
    expect(result).toMatchObject({ _tag: "rejected", reasons: expect.arrayContaining([expect.stringContaining("declared path")]) });
  });
  it("rejects links, non-file targets, dirty/conflicted source, and retained runs", async () => {
    const result = await admitDirectTask(input, runtime({
      inspectDeclaredPath: async (_root, path) => ({ path, kind: "symlink" }),
      inspectSource: async () => ({ changedPaths: ["README.md"], isConflicted: true }),
      findRetainedRunIds: async () => ["retained-1"],
    }));
    expect(result).toMatchObject({ _tag: "rejected", reasons: expect.arrayContaining([
      expect.stringContaining("symlink"), expect.stringContaining("not empty"), expect.stringContaining("structural conflict"), expect.stringContaining("retained-1"),
    ]) });
  });
});
