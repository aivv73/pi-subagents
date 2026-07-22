import { lstat, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { NodeIntegrationRuntime } from "./integration-runtime.js";
import { findPausedJournals } from "./jsonl-journal.js";
import type { DeclaredPathFacts, DirectTaskAdmissionRuntime } from "../ports/direct-task-admission.js";

const inside = (root: string, candidate: string): boolean => candidate === root || (!relative(root, candidate).startsWith(`..${sep}`) && relative(root, candidate) !== "..");

/** Node read-only admission adapter. Existing parents and targets must never cross symlinks. */
export class NodeDirectTaskAdmissionRuntime implements DirectTaskAdmissionRuntime {
  readonly #integration = new NodeIntegrationRuntime();

  async inspectSource(root: string) {
    const facts = await this.#integration.inspectSource(root);
    return { changedPaths: facts.changedPaths, isConflicted: facts.isConflicted };
  }

  async inspectDeclaredPath(root: string, path: string): Promise<DeclaredPathFacts> {
    const canonicalRoot = await realpath(root);
    const target = resolve(canonicalRoot, path);
    if (!inside(canonicalRoot, target)) return { path, kind: "outside_root" };
    const parent = dirname(target);
    const parentRelative = relative(canonicalRoot, parent);
    let current = canonicalRoot;
    for (const segment of parentRelative === "" ? [] : parentRelative.split(sep)) {
      current = resolve(current, segment);
      let parentFacts;
      try { parentFacts = await lstat(current); } catch { return { path, kind: "invalid_parent" }; }
      if (!parentFacts.isDirectory() || parentFacts.isSymbolicLink()) return { path, kind: "invalid_parent" };
    }
    if (!inside(canonicalRoot, await realpath(parent))) return { path, kind: "outside_root" };
    try {
      const facts = await lstat(target);
      if (facts.isSymbolicLink()) return { path, kind: "symlink" };
      if (facts.isFile()) return { path, kind: "regular_file" };
      return { path, kind: facts.isDirectory() ? "directory" : "other" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, kind: "absent" };
      throw error;
    }
  }

  async findRetainedRunIds(stateDirectory: string): Promise<readonly string[]> {
    return (await findPausedJournals(stateDirectory)).map((journal) => journal.runId);
  }
}
