import type { DirectTaskAdmissionRuntime } from "../ports/direct-task-admission.js";

export type DirectTaskAdmission =
  | { readonly _tag: "admitted"; readonly allowedTrackedPaths: readonly string[] }
  | { readonly _tag: "rejected"; readonly reasons: readonly string[] };

const protectedSegments = new Set([
  ".git", ".jj", ".rift", ".pi-subagents", ".ssh", ".gnupg", ".aws", ".npmrc", ".pypirc",
  "credentials", "secrets", "id_rsa", "id_ed25519",
]);
const isEnvironmentFile = (segment: string): boolean => segment === ".env" || segment.startsWith(".env.");

const lexicalPathIssue = (path: string): string | undefined => {
  if (path.length === 0 || path.includes("\0")) return "declared path is empty or contains NUL";
  if (path.includes("\\")) return `declared path must use repository slash separators: ${path}`;
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return `declared path is absolute: ${path}`;
  const segments = path.split(/[\\/]/);
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return `declared path is not normalized: ${path}`;
  if (segments.some((segment) => protectedSegments.has(segment) || isEnvironmentFile(segment))) return `declared path is protected: ${path}`;
  return undefined;
};

/** Validates declared write authority and mutable source/run admission without creating resources. */
export const admitDirectTask = async (input: {
  readonly sourceRoot: string;
  readonly stateDirectory: string;
  readonly allowedTrackedPaths: readonly string[];
}, runtime: DirectTaskAdmissionRuntime): Promise<DirectTaskAdmission> => {
  const reasons: string[] = [];
  const paths = [...new Set(input.allowedTrackedPaths)];
  if (paths.length === 0) reasons.push("at least one declared path is required");
  for (const path of paths) {
    const lexical = lexicalPathIssue(path);
    if (lexical !== undefined) { reasons.push(lexical); continue; }
    try {
      const facts = await runtime.inspectDeclaredPath(input.sourceRoot, path);
      if (facts.kind !== "regular_file" && facts.kind !== "absent") reasons.push(`declared path is not an allowed regular-file target: ${path} (${facts.kind})`);
    } catch (error) {
      reasons.push(`cannot validate declared path ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try {
    const source = await runtime.inspectSource(input.sourceRoot);
    if (source.changedPaths.length !== 0) reasons.push("source @ is not empty");
    if (source.isConflicted) reasons.push("source @ has a structural conflict");
  } catch (error) {
    reasons.push(`cannot inspect source admission state: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const retained = await runtime.findRetainedRunIds(input.stateDirectory);
    if (retained.length > 0) reasons.push(`retained non-terminal run prevents dispatch: ${retained.join(", ")}`);
  } catch (error) {
    reasons.push(`cannot inspect retained runs: ${error instanceof Error ? error.message : String(error)}`);
  }
  return reasons.length === 0 ? { _tag: "admitted", allowedTrackedPaths: paths } : { _tag: "rejected", reasons };
};
