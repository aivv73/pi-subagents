import { runDoctor } from "./doctor.js";
import type { DoctorEvidence, DoctorIssue, DoctorIssueCode } from "../domain/doctor-schema.js";
import type { PiMode } from "../command.js";
import type { PreflightEnvironment } from "../ports/preflight.js";

export type PreflightIssueCode = "unsupported_mode" | "project_untrusted" | "empty_task" | "parent_model_unauthenticated" | DoctorIssueCode;
export type PreflightIssue = DoctorIssue | { readonly code: Exclude<PreflightIssueCode, DoctorIssueCode>; readonly message: string };
export type PreflightEvidence = DoctorEvidence;

export type PreflightResult =
  | { readonly _tag: "preflight_failed"; readonly issues: readonly PreflightIssue[] }
  | { readonly _tag: "preflight_passed"; readonly evidence: PreflightEvidence };

export interface PreflightRequest {
  readonly mode: PiMode;
  readonly projectTrusted: boolean;
  readonly task: string;
  readonly parentModelAuthenticated: boolean;
  readonly cwd: string;
}

/** Applies Pi-only admission gates before delegating all read-only probes to the shared doctor. */
export const runPreflight = async (request: PreflightRequest, environment: PreflightEnvironment): Promise<PreflightResult> => {
  const issues: PreflightIssue[] = [];
  if (request.mode !== "tui") issues.push({ code: "unsupported_mode", message: "Subagent orchestration requires Pi TUI mode." });
  if (!request.projectTrusted) issues.push({ code: "project_untrusted", message: "Trust this project before starting subagent orchestration." });
  if (request.task.trim().length === 0) issues.push({ code: "empty_task", message: "A non-empty task is required." });
  if (!request.parentModelAuthenticated) issues.push({ code: "parent_model_unauthenticated", message: "The active parent model has no configured authentication." });
  if (issues.length > 0) return { _tag: "preflight_failed", issues };

  const doctor = await runDoctor({ cwd: request.cwd }, environment);
  if (doctor.status === "failed" || doctor.evidence === undefined) return { _tag: "preflight_failed", issues: doctor.issues };
  return { _tag: "preflight_passed", evidence: doctor.evidence };
};
