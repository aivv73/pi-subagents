import { execFile } from "node:child_process";
import { lstat, open, readFile, readdir, realpath, rename } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

import type { ChildGuardConfig } from "../domain/artifact-schema.js";

const execFileAsync = promisify(execFile);
const protectedSegments = new Set([
  ".git", ".jj", ".rift", ".pi-subagents", ".ssh", ".gnupg", ".aws", ".npmrc", ".pypirc",
  "credentials", "secrets", "id_rsa", "id_ed25519",
]);

export class GuardDeniedError extends Error {
  override readonly name = "GuardDeniedError";
}

const isEnvironmentFile = (segment: string): boolean => segment === ".env" || segment.startsWith(".env.");

const textLimit = (value: string, maxBytes: number): string =>
  Buffer.byteLength(value, "utf8") <= maxBytes ? value : `${Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8")}\n[truncated]`;

export class GuardedFilesystem {
  readonly #root: string;

  private constructor(
    root: string,
    readonly role: ChildGuardConfig["role"],
    readonly allowedTrackedPaths: ReadonlySet<string>,
    readonly maxReadBytes: number,
  ) {
    this.#root = root;
  }

  static async create(config: ChildGuardConfig): Promise<GuardedFilesystem> {
    if (!Number.isInteger(config.maxReadBytes) || config.maxReadBytes <= 0) throw new GuardDeniedError("invalid read size policy");
    const root = await realpath(config.root);
    const metadata = await lstat(root);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new GuardDeniedError("guard root must be a real directory");
    return new GuardedFilesystem(root, config.role, new Set(config.allowedTrackedPaths), config.maxReadBytes);
  }

  get root(): string {
    return this.#root;
  }

  async read(path: string): Promise<string> {
    const target = await this.resolveExisting(path);
    const metadata = await lstat(target);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new GuardDeniedError("read target must be a regular file");
    if (metadata.size > this.maxReadBytes) throw new GuardDeniedError("read target exceeds the configured size limit");
    return readFile(target, "utf8");
  }

  async search(query: string, maximumResults = 50): Promise<readonly { readonly path: string; readonly line: number; readonly text: string }[]> {
    if (query.length === 0) throw new GuardDeniedError("search query must not be empty");
    if (!Number.isInteger(maximumResults) || maximumResults < 1 || maximumResults > 100) throw new GuardDeniedError("invalid search result limit");
    const results: Array<{ path: string; line: number; text: string }> = [];
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (results.length >= maximumResults || this.isProtectedSegment(entry.name)) continue;
        const absolute = join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          await visit(absolute);
          continue;
        }
        if (!entry.isFile()) continue;
        const metadata = await lstat(absolute);
        if (metadata.size > this.maxReadBytes) continue;
        const content = await readFile(absolute, "utf8");
        for (const [index, line] of content.split("\n").entries()) {
          if (line.includes(query)) {
            results.push({ path: relative(this.#root, absolute), line: index + 1, text: textLimit(line, 2048) });
            if (results.length >= maximumResults) return;
          }
        }
      }
    };
    await visit(this.#root);
    return results;
  }

  async write(path: string, content: string): Promise<void> {
    this.assertWorkerWrite(path);
    const target = await this.resolveWriteTarget(path);
    const parent = dirname(target);
    const parentRealPath = await realpath(parent);
    this.assertAtOrInsideRoot(parentRealPath);
    const temporary = join(parentRealPath, `.${basename(target)}.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
  }

  async edit(path: string, oldText: string, newText: string): Promise<void> {
    if (oldText.length === 0) throw new GuardDeniedError("edit oldText must not be empty");
    const content = await this.read(path);
    const first = content.indexOf(oldText);
    if (first < 0 || content.indexOf(oldText, first + oldText.length) >= 0) {
      throw new GuardDeniedError("edit requires exactly one matching oldText");
    }
    await this.write(path, `${content.slice(0, first)}${newText}${content.slice(first + oldText.length)}`);
  }

  async jjIdentity(): Promise<string> {
    this.assertWorker();
    return this.runJj(["log", "--no-graph", "-r", "@", "-T", 'commit_id ++ "\\t" ++ change_id']);
  }

  async jjDescribe(description: string): Promise<string> {
    this.assertWorker();
    if (description.trim().length === 0 || description.length > 240 || description.includes("\0")) {
      throw new GuardDeniedError("invalid Jujutsu description");
    }
    return this.runJj(["describe", "-m", description]);
  }

  async jjDiff(): Promise<string> {
    if (this.role !== "reviewer") throw new GuardDeniedError("only reviewers may request a diff");
    return this.runJj(["diff", "--git", "--color", "never"]);
  }

  private async runJj(arguments_: readonly string[]): Promise<string> {
    const { stdout, stderr } = await execFileAsync("jj", [...arguments_], {
      cwd: this.#root,
      shell: false,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG ?? "C.UTF-8" },
      maxBuffer: this.maxReadBytes,
    });
    return textLimit(stdout || stderr, this.maxReadBytes);
  }

  private async resolveExisting(path: string): Promise<string> {
    const lexical = this.resolveLexical(path);
    await this.assertRealParents(lexical);
    const metadata = await lstat(lexical);
    if (metadata.isSymbolicLink()) throw new GuardDeniedError("symbolic links are not readable");
    const target = await realpath(lexical);
    this.assertInsideRoot(target);
    return target;
  }

  private async resolveWriteTarget(path: string): Promise<string> {
    const target = this.resolveLexical(path);
    await this.assertRealParents(target);
    try {
      const metadata = await lstat(target);
      if (metadata.isSymbolicLink() || !metadata.isFile()) throw new GuardDeniedError("write target is not a regular file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return target;
  }

  private async assertRealParents(target: string): Promise<void> {
    const pathRelative = relative(this.#root, dirname(target));
    let current = this.#root;
    for (const segment of pathRelative.split(sep)) {
      if (segment === "") continue;
      current = join(current, segment);
      const metadata = await lstat(current);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new GuardDeniedError("path has a non-directory or symbolic-link parent");
      }
    }
  }

  private resolveLexical(path: string): string {
    if (path.length === 0 || isAbsolute(path)) throw new GuardDeniedError("path must be a non-empty relative path");
    const rawSegments = path.split(/[\\/]/);
    if (rawSegments.some((segment) => segment === "" || segment === "." || segment === ".." || this.isProtectedSegment(segment))) {
      throw new GuardDeniedError("path is protected or escapes the guard root");
    }
    const normalized = normalize(path);
    const segments = normalized.split(sep);
    if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || this.isProtectedSegment(segment))) {
      throw new GuardDeniedError("path is protected or escapes the guard root");
    }
    const target = resolve(this.#root, normalized);
    this.assertInsideRoot(target);
    return target;
  }

  private assertInsideRoot(path: string): void {
    this.assertAtOrInsideRoot(path);
    const pathRelative = relative(this.#root, path);
    if (pathRelative === "") {
      throw new GuardDeniedError("path must not be the guard root");
    }
  }

  private assertAtOrInsideRoot(path: string): void {
    const pathRelative = relative(this.#root, path);
    if (pathRelative === ".." || pathRelative.startsWith(`..${sep}`)) {
      throw new GuardDeniedError("path escapes the guard root");
    }
  }

  private isProtectedSegment(segment: string): boolean {
    return protectedSegments.has(segment) || isEnvironmentFile(segment);
  }

  private assertWorker(): void {
    if (this.role !== "worker") throw new GuardDeniedError("reviewers cannot mutate task state");
  }

  private assertWorkerWrite(path: string): void {
    this.assertWorker();
    if (!this.allowedTrackedPaths.has(path)) throw new GuardDeniedError("write path is outside the declared task scope");
  }
}
