import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  decodeAttemptEnvelope,
  decodeResultArtifact,
  type AttemptEnvelope,
  type ChildGuardConfig,
  type ResultArtifact,
} from "../domain/artifact-schema.js";

const execFileAsync = promisify(execFile);
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const maxDefaultOutputBytes = 64 * 1024;

export class ArtifactError extends Error {
  override readonly name = "ArtifactError";
}

export interface AttemptArtifacts {
  readonly root: string;
  readonly directory: string;
  readonly inputPath: string;
  readonly checksumPath: string;
  readonly outputPath: string;
  readonly evidenceDirectory: string;
  readonly envelope: AttemptEnvelope;
}

const sha256 = (content: string): string => createHash("sha256").update(content).digest("hex");

const assertIdentifier = (name: string, value: string): void => {
  if (!identifierPattern.test(value)) throw new ArtifactError(`${name} must be a path-safe identifier`);
};

const assertContained = (root: string, candidate: string): void => {
  const path = resolve(candidate);
  const pathRelative = relative(root, path);
  if (pathRelative === "" || pathRelative === ".." || pathRelative.startsWith(`..${sep}`) || pathRelative.includes(`..${sep}`)) {
    throw new ArtifactError("artifact path escapes its repository root");
  }
};

const ensureDirectory = async (root: string, directory: string): Promise<void> => {
  assertContained(root, directory);
  const pathRelative = relative(root, directory);
  let current = root;
  for (const segment of pathRelative.split(sep)) {
    if (segment === "") continue;
    current = join(current, segment);
    try {
      const metadata = await lstat(current);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new ArtifactError(`artifact directory is not a real directory: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
      await chmod(current, 0o700);
    }
  }
};

const writePrivateFile = async (path: string, content: string): Promise<void> => {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, 0o400);
};

const assertPrivateRegularFile = async (path: string): Promise<void> => {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new ArtifactError(`artifact is not a regular file: ${path}`);
  if ((metadata.mode & 0o077) !== 0) throw new ArtifactError(`artifact permissions are too broad: ${path}`);
};

const strictKeys = (value: unknown, keys: readonly string[], location: string): void => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ArtifactError(`${location} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ArtifactError(`${location} has unexpected or missing fields`);
  }
};

const strictResult = (value: unknown): ResultArtifact => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ArtifactError("result artifact must be an object");
  const role = (value as { _tag?: unknown })._tag;
  if (role === "worker") {
    strictKeys(value, ["_tag", "schemaVersion", "runId", "taskId", "attemptId", "changeId", "commitId", "changedPaths"], "worker result");
  } else if (role === "reviewer") {
    strictKeys(value, ["_tag", "schemaVersion", "runId", "taskId", "attemptId", "commitId", "assignedBaseCommitId", "decision", "findings"], "reviewer result");
  } else {
    throw new ArtifactError("result artifact has an unknown role");
  }
  try {
    return decodeResultArtifact(value);
  } catch (error) {
    throw new ArtifactError(`invalid result artifact: ${String(error)}`);
  }
};

const assertResultBoundToEnvelope = (result: ResultArtifact, envelope: AttemptEnvelope): void => {
  if (
    result._tag !== envelope.role ||
    result.runId !== envelope.runId ||
    result.taskId !== envelope.taskId ||
    result.attemptId !== envelope.attemptId
  ) {
    throw new ArtifactError("result artifact identity does not match its envelope");
  }
  if (result._tag === "reviewer" && result.assignedBaseCommitId !== envelope.assignedBaseCommitId) {
    throw new ArtifactError("review result assigned base does not match its envelope");
  }
};

/** Adds and proves the repository-local ignore rule before any attempt artifacts are written. */
export const ensureArtifactIgnore = async (root: string): Promise<void> => {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: root, shell: false });
  const excludePath = resolve(root, stdout.trim());
  await ensureDirectory(root, dirname(excludePath));
  let contents = "";
  try {
    const metadata = await lstat(excludePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new ArtifactError("Git exclude path is not a regular file");
    contents = await readFile(excludePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!contents.split("\n").includes("/.pi-subagents/")) {
    const replacement = `${contents}${contents === "" || contents.endsWith("\n") ? "" : "\n"}/.pi-subagents/\n`;
    const temporary = `${excludePath}.pi-subagents-${randomUUID()}.tmp`;
    await writeFile(temporary, replacement, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, excludePath);
  }
  try {
    await execFileAsync("git", ["check-ignore", "-q", "--", ".pi-subagents/probe"], { cwd: root, shell: false });
  } catch {
    throw new ArtifactError("Git did not confirm .pi-subagents is ignored");
  }
};

export const currentJujutsuCommitId = async (root: string): Promise<string> => {
  const { stdout } = await execFileAsync("jj", ["log", "--no-graph", "-r", "@", "-T", "commit_id"], { cwd: root, shell: false });
  const commitId = stdout.trim();
  if (commitId === "") throw new ArtifactError("Jujutsu did not return current commit ID");
  return commitId;
};

/** Proves coordinator artifact writes leave the task change's commit ID unchanged. */
export const preserveCurrentCommit = async <A>(root: string, operation: () => Promise<A>): Promise<A> => {
  const before = await currentJujutsuCommitId(root);
  const result = await operation();
  const after = await currentJujutsuCommitId(root);
  if (before !== after) throw new ArtifactError("artifact write changed the current Jujutsu commit ID");
  return result;
};

export const createAttemptArtifacts = async (rootPath: string, envelopeValue: unknown): Promise<AttemptArtifacts> => {
  let envelope: AttemptEnvelope;
  try {
    envelope = decodeAttemptEnvelope(envelopeValue);
  } catch (error) {
    throw new ArtifactError(`invalid attempt envelope: ${String(error)}`);
  }
  for (const [name, value] of Object.entries({ runId: envelope.runId, taskId: envelope.taskId, attemptId: envelope.attemptId })) {
    assertIdentifier(name, value);
  }
  const root = await import("node:fs/promises").then(({ realpath }) => realpath(rootPath));
  if (envelope.root !== root) throw new ArtifactError("attempt envelope root does not match artifact repository root");
  if (envelope.outputRelativePath !== `output/${envelope.role}-result.v1.json`) {
    throw new ArtifactError("attempt envelope output path is not the version-one role result path");
  }
  await ensureArtifactIgnore(root);
  const commitBeforeArtifacts = await currentJujutsuCommitId(root);
  const directory = join(root, ".pi-subagents", "runs", envelope.runId, "tasks", envelope.taskId, "attempts", envelope.attemptId);
  const inputDirectory = join(directory, "input");
  const outputDirectory = join(directory, "output");
  const evidenceDirectory = join(directory, "evidence");
  await ensureDirectory(root, inputDirectory);
  await ensureDirectory(root, outputDirectory);
  await ensureDirectory(root, evidenceDirectory);

  const inputPath = join(inputDirectory, `${envelope.role}-envelope.v1.json`);
  const checksumPath = `${inputPath}.sha256`;
  const outputPath = join(outputDirectory, `${envelope.role}-result.v1.json`);
  assertContained(root, inputPath);
  assertContained(root, outputPath);
  const serialized = `${JSON.stringify(envelope)}\n`;
  await writePrivateFile(inputPath, serialized);
  await writePrivateFile(checksumPath, `${sha256(serialized)}\n`);
  const commitAfterArtifacts = await currentJujutsuCommitId(root);
  if (commitBeforeArtifacts !== commitAfterArtifacts) {
    throw new ArtifactError("attempt artifact creation changed the current Jujutsu commit ID");
  }

  return { root, directory, inputPath, checksumPath, outputPath, evidenceDirectory, envelope };
};

/** Reconstructs the fixed artifact layout from trusted coordinator guard configuration. */
export const artifactsForChildConfig = async (config: ChildGuardConfig): Promise<AttemptArtifacts> => {
  const root = await import("node:fs/promises").then(({ realpath }) => realpath(config.root));
  const envelope = config.envelope;
  const directory = join(root, ".pi-subagents", "runs", envelope.runId, "tasks", envelope.taskId, "attempts", envelope.attemptId);
  const inputPath = join(directory, "input", `${envelope.role}-envelope.v1.json`);
  const outputPath = join(directory, "output", `${envelope.role}-result.v1.json`);
  if (resolve(config.resultPath) !== outputPath || envelope.root !== root || config.role !== envelope.role) {
    throw new ArtifactError("child guard configuration does not bind to the attempt artifact layout");
  }
  return {
    root,
    directory,
    inputPath,
    checksumPath: `${inputPath}.sha256`,
    outputPath,
    evidenceDirectory: join(directory, "evidence"),
    envelope,
  };
};

export const readAttemptEnvelope = async (artifacts: AttemptArtifacts): Promise<AttemptEnvelope> => {
  await assertPrivateRegularFile(artifacts.inputPath);
  await assertPrivateRegularFile(artifacts.checksumPath);
  const [serialized, expectedChecksum] = await Promise.all([
    readFile(artifacts.inputPath, "utf8"),
    readFile(artifacts.checksumPath, "utf8"),
  ]);
  if (sha256(serialized) !== expectedChecksum.trim()) throw new ArtifactError("attempt envelope checksum does not match");
  try {
    return decodeAttemptEnvelope(JSON.parse(serialized) as unknown);
  } catch (error) {
    throw new ArtifactError(`invalid stored attempt envelope: ${String(error)}`);
  }
};

export const writeResultAtomically = async (
  artifacts: AttemptArtifacts,
  serializedResult: string,
  maximumBytes = maxDefaultOutputBytes,
): Promise<ResultArtifact> => {
  if (Buffer.byteLength(serializedResult, "utf8") > maximumBytes) throw new ArtifactError("result artifact exceeds maximum size");
  let result: ResultArtifact;
  try {
    result = strictResult(JSON.parse(serializedResult) as unknown);
  } catch (error) {
    if (error instanceof ArtifactError) throw error;
    throw new ArtifactError(`result artifact is not JSON: ${String(error)}`);
  }
  const envelope = await readAttemptEnvelope(artifacts);
  assertResultBoundToEnvelope(result, envelope);
  const commitBeforeResult = await currentJujutsuCommitId(artifacts.root);
  const temporary = join(dirname(artifacts.outputPath), `.${randomUUID()}.result.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(serializedResult, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, artifacts.outputPath);
  await chmod(artifacts.outputPath, 0o600);
  const metadata = await lstat(artifacts.outputPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximumBytes) {
    await rm(artifacts.outputPath, { force: true });
    throw new ArtifactError("result artifact is not a bounded regular file");
  }
  const commitAfterResult = await currentJujutsuCommitId(artifacts.root);
  if (commitBeforeResult !== commitAfterResult) {
    throw new ArtifactError("result artifact write changed the current Jujutsu commit ID");
  }
  return result;
};

export const readResultArtifact = async (artifacts: AttemptArtifacts, maximumBytes = maxDefaultOutputBytes): Promise<ResultArtifact> => {
  const metadata = await lstat(artifacts.outputPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximumBytes) {
    throw new ArtifactError("result artifact is not a bounded regular file");
  }
  const result = strictResult(JSON.parse(await readFile(artifacts.outputPath, "utf8")) as unknown);
  assertResultBoundToEnvelope(result, await readAttemptEnvelope(artifacts));
  return result;
};
