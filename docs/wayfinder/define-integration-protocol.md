# Define isolated change and integration protocol

**Type:** grilling  
**Status:** closed  
**Blocked by:** [Research Herdr coordination primitives](research-herdr-coordination-primitives.md), [Validate Rift and Jujutsu composition](prototype-rift-jj-composition.md), [Choose worker hosting and Herdr boundary](choose-worker-hosting.md)

## Question

What protocol governs workspace ownership, revision identity, reviewer evidence and approval, bounded revision, integration ordering, conflicts, and escalation?

## Notes

The chosen baseline is a dedicated reviewer subagent. Rejection returns feedback to the original worker for a bounded retry and re-review.

## Resolution

### Identities and ownership

Every run, task, attempt, workspace, publication, and review has a coordinator-generated opaque ID. Human-readable names are labels only.

- One worker attempt exclusively owns one Rift workspace and one Herdr pane.
- A retry after execution failure gets a fresh attempt, workspace, pane, and task change ID.
- A reviewer-requested revision reuses the original successful worker attempt and workspace.
- Every reviewer invocation gets a separate exact Rift snapshot and Herdr pane. Reviewer tools are read-only with respect to tracked source; tests may write ignored/build outputs inside the reviewer snapshot.
- The coordinator source workspace is never given to a worker or reviewer process.
- Only the coordinator may mutate transport refs in the coordinator repository or perform final integration.

### Assigned base and worker bootstrap

At dispatch, the coordinator records an immutable assigned base commit containing all integrated dependencies. It creates an exact Rift snapshot with hooks disabled and starts the worker only after validating Rift ancestry and repository state.

Because Rift duplicates the source working-copy change ID, worker bootstrap must create a fresh task change from the exact assigned base before any task mutation. The coordinator records:

- assigned base commit ID;
- copied source working-copy change ID, which is forbidden as a result ID;
- fresh task change ID and initial commit ID;
- allowed revision shape and path/scope constraints;
- unique temporary transport bookmark.

### Revision shape

- Default: exactly one non-empty, described task change directly based on the assigned base.
- A task may explicitly allow an ordered stack.
- Default maximum stack length is five changes and remains configurable downward or upward within a global safety cap.
- Every stack member must be non-empty, described, authored during the attempt, descendant of the assigned base, and listed in parent-before-child order.
- Merge commits, unrelated ancestors, mutable external bookmarks, and changes outside the task’s declared scope are rejected unless the task contract explicitly allows them.
- Publication contains exactly the reported stack under one unique temporary bookmark such as `refs/heads/pi-subagents/<run>/<task>/<attempt>` in a coordinator-owned local bare Git repository.

### Worker result and publication

The worker writes a versioned JSON result artifact atomically through temporary-file-plus-rename. It binds:

- schema version and all coordinator identities;
- assigned base and ordered change/commit IDs;
- transport bookmark and expected remote target commit;
- summary, changed paths, checks run, outcomes, evidence paths, proposed tasks, and diagnostics;
- terminal worker status.

The coordinator validates the artifact, independently queries `jj`, verifies ancestry/scope/shape, then permits publication with credentials restricted to the local transport remote and assigned bookmark. After fetch, it verifies that the fetched commit ID exactly equals the artifact target. Any ref movement after validation invalidates the result and review.

### Review snapshot and approval contract

The coordinator creates the reviewer snapshot only after fetching and validating worker commits. The snapshot contains the current deterministic integration base and immutable fetched worker refs.

The reviewer must validate:

1. coordinator/result schema identities and exact commit binding;
2. assigned-base ancestry and allowed stack shape;
3. complete diff and declared path/scope boundaries;
4. absence of unrelated, generated, secret, or suspicious changes;
5. task acceptance criteria and worker evidence;
6. required tests/checks, rerunning them when practical;
7. interaction with already integrated changes at the deterministic integration base.

Reviewer output is a separate versioned JSON artifact atomically written in its snapshot. `approved` binds the exact ordered commit IDs, integration base, checks, and findings. `revision_requested` contains bounded, actionable findings tied to files/commits. Terminal text or Herdr `done` never grants approval.

### Revision loop

- Reviewer-requested revisions return to the original worker and workspace.
- Revision cycles are configurable and default to one.
- The worker updates the same task change/stack and temporary bookmark using lease-protected publication, then emits a new result artifact revision.
- Every revision invalidates all previous approvals and receives a fresh reviewer snapshot and full review.
- Exceeding the review revision budget fails the task and escalates with retained diagnostics.

### Deterministic integration

- A task is integration-eligible only with a valid approval bound to the fetched commit IDs and the current integration base.
- Among eligible independent tasks, integrate in deterministic topological order, then task creation order, then task ID. Approval timing never changes order.
- If an earlier integration changes the base for a later approved task, re-evaluate that task against the new base before integration. A clean semantic merge may proceed; any changed diff or conflict invalidates the old integration-base binding and enters conflict handling.
- The coordinator integrates using normal Jujutsu merge/change operations and records before/after operation IDs and resulting commit IDs.
- Dependents become dispatchable only after their dependencies are durably integrated and verified.

### Conflict handling

- The coordinator never chooses conflict sides mechanically.
- An integration conflict is materialized in a fresh conflict-resolution workspace derived from the latest integration base plus the approved worker changes, then returned to the original worker with exact conflict context.
- After worker resolution, the result is republished and must receive fresh reviewer approval.
- Conflict-resolution cycles have a separate configurable budget, defaulting to one additional cycle beyond the normal review revision budget.
- Exceeding that budget pauses the task for user resolution; transitive dependents remain blocked while independent branches continue.

### Cleanup and retention

- Immediately after terminal integration disposition, delete the temporary transport bookmark locally and remotely with lease checks. Ref cleanup failure is recorded and retried; it does not roll back an already verified integration.
- Successfully integrated worker and reviewer Rift workspaces are retained until end-of-run by default, with configurable immediate cleanup.
- End-of-run cleanup removes retained successful workspace subtrees and schedules `rift gc`.
- Failed, force-cancelled, protocol-invalid, and conflict-escalated workspaces are retained by default for diagnostics and listed in the run summary; retention is bounded by age/size policy.
- Cleanup is idempotent and validates Rift marker/registry identity before removal. The coordinator never invokes root-unregister behavior.
- A reconciliation pass detects stale transport refs, missing/trashed Rifts, and orphan Herdr panes after interruption.

### Security invariants

- Project postcreate hooks are disabled unless a later trusted-project policy explicitly permits them.
- Worker Git credentials can update only the assigned local transport bookmark, never upstream remotes.
- Result/review paths must remain inside their owned Rift roots and may not be symlinks escaping those roots.
- IDs, commit hashes, operation IDs, and artifact revisions—not pane names or terminal text—are authority tokens.
- No unreviewed or revision-invalidated commit may enter the coordinator integration state.

## Map

[Effect-based Pi subagent orchestration](README.md)

## Unlocks

- [Choose Effect architecture and module boundaries](choose-effect-architecture.md)
