# SPEC-task-graph: Task graph and run semantics

The coordinator owns one validated directed acyclic task graph per run.

## Decomposition

A candidate graph contains stable task IDs, purpose, role, inputs, acceptance criteria, expected structured output, dependencies, and creation order. Before resource creation the coordinator rejects invalid schema, duplicate/missing IDs, cycles, out-of-scope work, duplicated outputs, or exceeded limits. The decomposer receives one repair attempt; a second invalid graph fails the run.

Workers may propose tasks only through their result artifact. The coordinator inserts a proposal automatically when it is valid, in scope, acyclic, non-duplicative, explicit about dependencies/output, and within configured limits. Material scope/risk/limit expansion requires user attention.

## States

Tasks move through `pending`, `ready`, `running`, `awaiting_review`, `revision_requested`, `approved`, and `integrated`, with `blocked`, `retry_wait`, `failed`, `cancelling`, and `cancelled` alternatives.

A task is ready only when all direct dependencies are integrated. Herdr lifecycle values are observations and cannot advance semantic state without validated artifacts/repository facts.

Runs terminate as:

- `succeeded`: every task integrated;
- `partially_failed`: a task failed or was causally blocked after independent work settled;
- `cancelled`: cancellation settled with no active semantic work;
- `failed`: decomposition or a coordinator invariant failed before meaningful partial completion.

## Scheduling

Ready tasks are ordered by the number of non-terminal transitive dependents they unlock, then creation order, then task ID. A priority queue holds candidates, which are revalidated before dispatch. Finite global, worker, and reviewer limits apply, with reviewer capacity reserved against worker starvation.

## Failure and retries

Execution retries are configurable and default to one fresh attempt/workspace from the same base. Result-artifact repair and reviewer-requested revision are separate budgets.

After retries are exhausted, the task fails, all transitive non-terminal dependents become causally blocked, and independent branches continue.

When Herdr reports `blocked`, only that task pauses and enters user attention; no permission is automatically approved.

## Cancellation

Cancellation stops dispatch, requests cooperative settlement, then sends `Ctrl+C` after a grace period and closes the pane after a forced timeout. Forced-stop workspaces are retained for diagnostics. Pending work becomes cancelled; integrated work remains integrated; unapproved work is never integrated.

The terminal summary includes task states, causal failures, integrated revisions, retained resources, rejected proposals, and cleanup status.

Architecture and persistence follow [ARCH-pi-subagents](ARCH-pi-subagents.md).

