import type { ChildGuardConfig } from "../domain/artifact-schema.js";

const safeEnvironmentKeys = ["PATH", "HOME", "XDG_CONFIG_HOME", "LANG", "LC_ALL", "TERM", "COLORTERM", "NO_COLOR"] as const;

/** Builds the only environment passed to child Pi; credentials are resolved by Pi, never exposed as tools. */
export const childEnvironment = (
  parent: NodeJS.ProcessEnv,
  guardConfig: ChildGuardConfig,
): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of safeEnvironmentKeys) {
    if (parent[key] !== undefined) environment[key] = parent[key];
  }
  environment.PI_SUBAGENTS_GUARD_CONFIG = JSON.stringify(guardConfig);
  return environment;
};

/** Explicit child Pi launch policy. The caller supplies only this extension path, never project resources. */
export const childPiArguments = (childExtensionPath: string): readonly string[] => [
  "--no-builtin-tools",
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-context-files",
  "--no-themes",
  "--no-session",
  "--no-approve",
  "--extension",
  childExtensionPath,
];
