# SPEC-change-integration: Isolated revision, review, and integration protocol

One worker attempt exclusively owns one Rift workspace, Herdr pane, fresh Jujutsu task change, artifact area, and `pi-subagents/<run>/<task>/<attempt>` transport ref. The coordinator source workspace is never exposed to agents. The current implementation creates and retains the snapshot/pane/artifact/task-change subset and publishes/fetches that one ref; ref cleanup is not implemented yet.

## Revision contract

The assigned base includes all integrated dependencies. Worker bootstrap records the copied forbidden working-copy change ID and creates a fresh change from the exact base.

The current contract accepts exactly one non-empty described, non-merge task change with one parent equal to assigned base. It must be descendant of that base, conflict-free, in declared path scope, free of tracked `.pi-subagents` artifacts, and exactly agree with the structured result's change and commit IDs. Stacks, result repair, project checks, and execution retry are unsupported.

The coordinator independently validates artifact and repository facts after Herdr settlement. Settlement/idle text alone never completes an attempt. A blocked agent or invalid result stops progression and retains its Rift/pane/artifact identities for diagnostics. Immediately before publication it reads the artifact and repository facts again; any changed result identity, changed revision identity, failed shape/scope validation, or stale artifact fails before a ref mutation.

The coordinator alone creates the local bare Git transport below its state directory and adds its named local remote. It fetches the exact ref before Jujutsu pushes it, so Jujutsu's remote-bookmark safety check acts as a lease. A new first-slice attempt ref must be absent; an existing or moved ref fails rather than being overwritten. After push the coordinator directly checks the bare target, fetches only that ref into the source repository, and requires artifact, worker, bare-ref, fetched commit, fetched change, and assigned-base ancestry identities to agree exactly. Generic external intent/outcome journal events durably bracket this effect. Workers cannot alter remotes, refs, upstreams, or credentials. Ref movement invalidates prior validation/review.

## Review

Each review uses a separate exact Rift snapshot created from coordinator state containing the current integration base and immutable fetched worker ref; it never uses the worker or coordinator workspace directly. The reviewer receives only a fixed complete diff from assigned base to reviewed commit plus contained read/search. It verifies identities, ancestry, one-change shape, complete diff, scope, unrelated/suspicious changes, and the explicit user request. Project command execution and required checks are not implemented in this slice.

Approval and rejection bind exact reviewed commit and integration base. Before accepting either decision, the coordinator rechecks the reviewer result, target revision facts, source fetched-ref/base bindings, and unchanged reviewer working-copy identity. Herdr settlement alone, malformed output, a moved ref/base, or tracked reviewer mutation fails closed. An accepted decision appends the corresponding semantic `review_approved` or `review_revision_requested` journal event. Reviewer rejection returns actionable findings to the original worker/workspace in the later revision-loop slice.

Reviewer tracked mutation fails the review invocation.

## Integration

Eligible independent tasks integrate in topological, creation, then task-ID order. Before each integration the coordinator evaluates the approved changes against the current integration base. A changed effective diff or conflict invalidates the old base binding.

The coordinator records Jujutsu operation/commit IDs and structurally checks unresolved conflicts. File text or command success alone cannot prove integration.

Conflicts return to the original worker in an assigned conflict-resolution workspace/context and require republishing and fresh review. Conflict cycles have a separate configurable budget, default one; exhaustion requires user attention while independent branches continue.

## Cleanup

Temporary refs are deleted with lease checks after terminal disposition. Successful workspaces remain until run end by default. Failed, forced, invalid, or escalated resources are retained under bounded diagnostic policy. Cleanup is idempotent, verifies Rift identity, never unregisters the source root, and reconciles stale refs/panes/workspaces after interruption.

This protocol depends on [DESIGN-herdr-rift-jj](DESIGN-herdr-rift-jj.md) and [SPEC-agent-protocol](SPEC-agent-protocol.md).
