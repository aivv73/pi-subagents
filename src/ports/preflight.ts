export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Read-only operating-system capabilities used by the preflight application service. */
export interface PreflightEnvironment {
  readonly platform: string;
  readonly nodeVersion: string;
  run(executable: string, arguments_: readonly string[], cwd: string): Promise<CommandResult>;
  filesystemType(path: string): Promise<string>;
  canWriteDirectory(path: string): Promise<boolean>;
  canonicalPath(path: string): Promise<string>;
  coordinatorStateDirectory(repositoryId: string): string;
}
