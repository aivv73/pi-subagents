import { mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { NodeDirectTaskAdmissionRuntime } from "./direct-task-admission.js";

describe("NodeDirectTaskAdmissionRuntime", () => {
  it("classifies existing files, declared new files, and symlink targets without escaping root", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-subagents-admission-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "README.md"), "readme");
    await symlink("README.md", join(root, "linked.md"));
    await symlink("src", join(root, "linked-src"));
    const runtime = new NodeDirectTaskAdmissionRuntime();
    await expect(runtime.inspectDeclaredPath(root, "README.md")).resolves.toMatchObject({ kind: "regular_file" });
    await expect(runtime.inspectDeclaredPath(root, "src/new.ts")).resolves.toMatchObject({ kind: "absent" });
    await expect(runtime.inspectDeclaredPath(root, "linked.md")).resolves.toMatchObject({ kind: "symlink" });
    await expect(runtime.inspectDeclaredPath(root, "linked-src/new.ts")).resolves.toMatchObject({ kind: "invalid_parent" });
    await expect(runtime.inspectDeclaredPath(root, "missing/new.ts")).resolves.toMatchObject({ kind: "invalid_parent" });
    await expect(runtime.inspectDeclaredPath(root, "../outside")).resolves.toMatchObject({ kind: "outside_root" });
  });
});
