# Define task graph and execution semantics

**Type:** grilling  
**Status:** closed  
**Blocked by:** [Research Pi extension orchestration boundaries](research-pi-extension-orchestration.md), [Research Rift workspace lifecycle](research-rift-workspace-lifecycle.md), [Research Herdr coordination primitives](research-herdr-coordination-primitives.md), [Choose worker hosting and Herdr boundary](choose-worker-hosting.md)

## Question

What exact task-graph model and runtime semantics govern automatic decomposition, dependencies, concurrency, cancellation, retries, failures, and terminal states?

## Resolution

### Graph authority and validation

- The coordinator owns one directed acyclic task graph per run.
- Initial decomposition returns a complete candidate DAG with stable task IDs, purpose, inputs, expected structured output, dependencies, worker role, and creation order.
- Before dispatch, the coordinator validates schema, unique IDs, acyclicity, dependency existence, scope, resource limits, and non-duplicated outputs.
- Invalid initial decomposition is returned to the decomposer for one repair attempt. A second invalid graph fails the run before any Rift workspace is created.
- The initial graph is not permanently fixed. Workers may propose tasks in their versioned result artifact, but cannot create or dispatch them.
- The coordinator automatically inserts a proposed task only when it is in destination scope, schema-valid, acyclic, within task/concurrency/cost limits, non-duplicative, and has explicit dependencies and output. Rejected proposals are recorded as diagnostics; proposals involving material scope, risk, or limit expansion escalate to the user.

### Task states

Each task is in exactly one state:

```text
pending -> ready -> running -> awaiting_review -> approved -> integrated
                    |             |                 |
                    |             +-> revision_requested -> running
                    +-> blocked
                    +-> retry_wait -> ready
                    +-> failed

pending/ready/running/awaiting_review/revision_requested/blocked/retry_wait
  -> cancelling -> cancelled
```

- `pending`: at least one dependency is not integrated.
- `ready`: every dependency is integrated and capacity is available or awaited.
- `running`: one Herdr worker attempt owns one Rift workspace.
- `awaiting_review`: a valid result and published revision passed coordinator validation.
- `revision_requested`: the reviewer rejected with bounded feedback; the original worker and workspace receive that feedback.
- `approved`: reviewer approval is valid but integration has not completed.
- `integrated`: terminal success.
- `blocked`: user input/approval is required or an upstream task permanently failed.
- `retry_wait`: execution attempt failed but retry policy permits a fresh attempt.
- `failed`: terminal task failure.
- `cancelling` and `cancelled`: cooperative or completed cancellation.

Herdr’s `idle`, `done`, `working`, `blocked`, and `unknown` remain observations, not task states. Only validated result/reviewer artifacts and repository checks advance semantic states.

### Readiness and scheduling

- A task becomes ready only after every direct dependency reaches `integrated`.
- Among ready tasks, prioritize the task that unlocks the greatest number of currently non-terminal transitive dependents. Break ties by stable creation order and then task ID.
- Dispatch is constrained by separate configurable worker and reviewer limits plus a global active-agent cap.
- Defaults are an architecture/configuration detail, but all limits must be finite and positive. Reserve reviewer capacity so saturated workers cannot starve review.
- Dynamic insertion reruns readiness and priority calculation without interrupting already running tasks.

### Failure and retries

- Worker execution failures receive a configurable number of automatic retries, defaulting to one.
- An execution retry uses a fresh Rift workspace and fresh Herdr process/attempt ID from the same assigned base. Failed-attempt workspaces are retained until the replacement starts successfully, then cleaned according to diagnostic retention policy.
- Retry backoff and retryability are typed policy decisions; schema/protocol violations, transient Herdr/process failure, and provider failure are distinguishable from deterministic task failure.
- The one repair-only prompt for a missing/invalid result artifact is not an execution retry and may not repeat task mutations.
- Reviewer-requested revision is not an execution retry: feedback returns to the original worker in its existing workspace, then the same revision is re-reviewed. The bounded revision count is defined by the integration protocol.
- After retries are exhausted, mark the task `failed`, mark every non-terminal transitive dependent `blocked` with the causal task ID, and continue independent graph branches.

### Agent blocking

- When Herdr reports `blocked`, pause only that task, surface its terminal snapshot and context to the user, and continue independent branches.
- User response resumes the same agent. Rejection or timeout follows typed task failure policy rather than granting automatic approval.
- The coordinator never automatically approves agent permission or question prompts.

### Cancellation

- User cancellation atomically stops new dispatch and moves active/non-terminal tasks toward `cancelling`.
- Running workers and reviewers first receive cooperative cancellation and are allowed a configurable grace period to settle and write diagnostics.
- Independent work does not newly start during cancellation.
- After grace expiry, send `Ctrl+C`, wait a short forced-stop timeout, then close the Herdr pane.
- Forced-stop Rift workspaces are retained for diagnostics. Unapproved work is never integrated during cancellation.
- Ready/pending/retry-wait tasks become `cancelled`; already integrated tasks remain integrated. Cleanup is idempotent and may continue after the run reaches its terminal summary.

### Run terminal states

```text
succeeded         every task integrated
partially_failed  at least one task failed/causally blocked, independent work settled
cancelled         cancellation completed; no active semantic work remains
failed            decomposition or coordinator-level invariant failed before meaningful partial completion
```

The terminal summary includes every task state, causal failures, retained diagnostic workspaces, integrated revisions, cleanup status, and newly proposed/rejected tasks. A run cannot report success from Herdr settlement alone.

## Map

[Effect-based Pi subagent orchestration](README.md)

## Unlocks

- [Choose Effect architecture and module boundaries](choose-effect-architecture.md)
