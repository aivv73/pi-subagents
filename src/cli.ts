#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

import { nodePreflightEnvironment } from "./adapters/node-preflight.js";
import { runDoctor } from "./application/doctor.js";
import type { DoctorReport } from "./domain/doctor-schema.js";
import type { PreflightEnvironment } from "./ports/preflight.js";

export interface DoctorCliDependencies {
  readonly cwd: string;
  readonly environment: PreflightEnvironment;
  readonly doctor: (request: { readonly cwd: string }, environment: PreflightEnvironment) => Promise<DoctorReport>;
}

export interface DoctorCliResult {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

const usage = "Usage: pi-subagents doctor --json\n";
const safeError = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 1024);

/** Pure CLI adapter: the shared doctor service remains the sole capability authority. */
export const runDoctorCli = async (
  arguments_: readonly string[],
  dependencies: DoctorCliDependencies,
): Promise<DoctorCliResult> => {
  if (arguments_.length !== 2 || arguments_[0] !== "doctor" || arguments_[1] !== "--json") {
    return { exitCode: 2, stdout: "", stderr: usage };
  }
  try {
    const report = await dependencies.doctor({ cwd: dependencies.cwd }, dependencies.environment);
    return { exitCode: report.status === "passed" ? 0 : 1, stdout: `${JSON.stringify(report)}\n`, stderr: "" };
  } catch (error) {
    return { exitCode: 2, stdout: "", stderr: `pi-subagents doctor failed: ${safeError(error)}\n` };
  }
};

const main = async (): Promise<void> => {
  const result = await runDoctorCli(process.argv.slice(2), {
    cwd: process.cwd(),
    environment: nodePreflightEnvironment(),
    doctor: runDoctor,
  });
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  void main();
}
