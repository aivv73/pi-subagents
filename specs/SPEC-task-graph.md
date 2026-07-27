# SPEC-task-graph: Task graph and run semantics

The current injected coordinator supervisor owns one direct task per run. The public Pi command dispatches it in the background only after admission, then returns the generated run ID. It has no graph, decomposition, dynamic task creation, queue, concurrency, or execution retry.

## Decomposition

The direct task originates from `/subagents run --paths path[,path...] <task>`. Admission requires a clean conflict-free source working copy and no unfinished retained run in that repository state directory, but neither condition starts recovery. It has no dependencies and does not invoke a decomposer. Worker-proposed tasks, task repair, and task graph validation are unsupported.

## States

The direct task moves through `pending`, `running`, `awaiting_review`, `revision_requested`, `approved`, and `integrated`, with `blocked`, `failed`, `cancelling`, and `cancelled` alternatives. Only typed journal facts advance the semantic state; process lifecycle labels do not.

Runs terminate as:

- `succeeded`: the direct task integrated and cleanup completed;
- `succeeded_with_cleanup_warning`: the direct task integrated but cleanup reported a warning;
- `cancelled`: cancellation settled with no integration;
- `failed`: a coordinator invariant or protocol failed before integration.

## Scheduling

`SingleRunRegistry` permits one active direct run. The supervisor allocates its run/task/attempt identities and creates the journal before beginning the worker sequence; it always releases only the process-local claim at a terminal or retained disposition. There is no ready queue, priority ordering, role capacity, or concurrent task scheduling.

## Failure and retries

The state model permits exactly one reviewer-requested revision. The implemented revision reuses the original worker attempt/Rift/pane/change ID, requires an amended commit and fresh publication/review, and invalidates the old commit's approval/publication facts. A second rejection fails while retaining diagnostics. Execution retry and result-artifact repair are unsupported and cannot consume the reviewer-revision budget. A blocked worker or reviewer produces a `blocked` semantic state; it is never approved automatically.

## Cancellation

`/subagents cancel` addresses the sole process-local active run. Cancellation moves the task through `cancelling` to `cancelled`. The coordinator asks each known agent to stop, waits a bounded interval, then sends one pane `Ctrl+C` when needed; all cancellation resources remain retained even when settlement is uncertain. It is refused after integration starts, because cancellation cannot trigger integration, cleanup, or rollback. An absent active run is informational. The current journal scanner reports unfinished runs as paused and does not resume or delete them.

Architecture and persistence follow [ARCH-pi-subagents](ARCH-pi-subagents.md).
