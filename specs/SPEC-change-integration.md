# SPEC-change-integration: Isolated revision, review, and integration protocol

One worker attempt exclusively owns one Rift workspace, Herdr pane, fresh Jujutsu task change, artifact area, and `pi-subagents/<run>/<task>/<attempt>` transport ref. The coordinator source workspace is never exposed to agents. The current implementation creates and retains the snapshot/pane/artifact/task-change subset, publishes/fetches that one ref, and removes the exact ref only after verified integration; pre-integration resources remain retained.

## Revision contract

The assigned base includes all integrated dependencies. Worker bootstrap records the copied forbidden working-copy change ID and creates a fresh change from the exact base.

The current contract accepts exactly one non-empty described, non-merge task change with one parent equal to assigned base. It must be descendant of that base, conflict-free, in declared path scope, free of tracked `.pi-subagents` artifacts, and exactly agree with the structured result's change and commit IDs. Stacks, result repair, project checks, and execution retry are unsupported.

The coordinator independently validates artifact and repository facts after Herdr settlement. Settlement/idle text alone never completes an attempt. A blocked agent or invalid result stops progression and retains its Rift/pane/artifact identities for diagnostics. Immediately before publication it reads the artifact and repository facts again; any changed result identity, changed revision identity, failed shape/scope validation, or stale artifact fails before a ref mutation.

The coordinator alone creates the local bare Git transport below its state directory and adds its named local remote. It fetches the exact ref before Jujutsu pushes it, so Jujutsu's remote-bookmark safety check acts as a lease. Initial publication requires an absent attempt ref. The one permitted reviewer amendment reuses that ref only when it still targets the exact previously reviewed commit; a moved or unexpected ref fails rather than being overwritten. After push the coordinator directly checks the bare target, fetches only that ref into the source repository, and requires artifact, worker, bare-ref, fetched commit, fetched change, and assigned-base ancestry identities to agree exactly. Generic external intent/outcome journal events durably bracket this effect. Workers cannot alter remotes, refs, upstreams, or credentials. Ref movement invalidates prior validation/review.

## Review

Each review uses a separate exact Rift snapshot created from coordinator state containing the current integration base and immutable fetched worker ref; it never uses the worker or coordinator workspace directly. The reviewer receives only a fixed complete diff from assigned base to reviewed commit plus contained read/search. It verifies identities, ancestry, one-change shape, complete diff, scope, unrelated/suspicious changes, and the explicit user request. Project command execution and required checks are not implemented in this slice.

Approval and rejection bind exact reviewed commit and integration base. Before accepting either decision, the coordinator rechecks the reviewer result, target revision facts, source fetched-ref/base bindings, and unchanged reviewer working-copy identity. Herdr settlement alone, malformed output, a moved ref/base, or tracked reviewer mutation fails closed. An accepted decision appends the corresponding semantic `review_approved` or `review_revision_requested` journal event.

The first and only `revision_requested` returns its findings to the original worker workspace/pane. That worker must amend the same task change ID to a new commit, replace its result artifact, pass fresh worker validation, update the temporary ref under a prior-commit lease, and receive a newly created reviewer snapshot. Publication/review results from the old commit are invalid immediately. A second rejection appends `run_failed` and retains diagnostics; protocol repair, malformed output, blocked execution, and retry do not consume this budget.

Reviewer tracked mutation fails the review invocation.

The direct-run supervisor invokes this sequence only after it has journaled run creation and worker start. It records each worker/reviewer Rift and Herdr identity as soon as the attempt returns, retains all of them on pre-integration invalid/blocked/failure disposition, and passes every known identity to cancellation or verified cleanup. It never treats a service return or terminal text as approval without that service's existing validation.

## Integration

The current single-task integration requires an exact `approved` reviewer decision, fetched transport commit/change identity, approved revision facts, a clean source `@`, and source `@-` equal to the assigned base immediately before mutation. Public direct-task admission separately requires that source condition before dispatch and rejects a repository state directory with an unfinished run; it does not resume or clean that run. Any drift, stale approval/ref, scope/shape failure, or structural conflict returns a retained failure and does not mutate source.

On success the coordinator journals the pre-mutation operation ID, runs only `jj new <approved-commit>` in source, then records the resulting operation ID. It requires the new source `@` to be a conflict-free empty change directly parented by the approved commit. File text and command success alone cannot prove integration, and worker files are never copied into source.

Topological ordering, changed effective-diff re-evaluation, rebase, and conflict resolution are not implemented for the one-task slice.

Conflicts return to the original worker in an assigned conflict-resolution workspace/context and require republishing and fresh review. Conflict cycles have a separate configurable budget, default one; exhaustion requires user attention while independent branches continue.

## Cleanup

After verified integration, the current cleanup path lease-deletes the exact temporary ref, closes known Herdr panes, removes known non-source Rift roots, and invokes Rift GC. It treats an already absent ref/Rift as cleaned, refuses a source-root match, and continues through independent cleanup steps. Complete cleanup reports `succeeded`; any post-integration cleanup failure reports `succeeded_with_cleanup_warning` and never rolls back integration. Failed, forced, invalid, blocked, cancelled, or pre-integration resources are retained for diagnostics. Reconciliation of stale resources and old-run cleanup are not implemented.

This protocol depends on [DESIGN-herdr-rift-jj](DESIGN-herdr-rift-jj.md) and [SPEC-agent-protocol](SPEC-agent-protocol.md).
