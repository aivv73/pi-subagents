# SPEC-change-integration: Isolated revision, review, and integration protocol

One worker attempt exclusively owns one Rift workspace, Herdr pane, fresh Jujutsu task change, artifact area, and temporary transport bookmark. The coordinator source workspace is never exposed to agents.

## Revision contract

The assigned base includes all integrated dependencies. Worker bootstrap records the copied forbidden working-copy change ID and creates a fresh change from the exact base.

Default publication is one non-empty described change. A task may allow an ordered stack, default maximum five. Every member must be attempt-authored, descendant of the assigned base, within declared scope, and listed parent-first.

The worker result binds exact change/commit IDs, base, transport bookmark/target, paths, checks, and evidence. The coordinator independently validates repository state before publication and after fetch.

Workers can update only their lease-protected temporary bookmark in a coordinator-owned local bare Git repository. They have no upstream credentials. Ref movement invalidates prior validation/review.

## Review

Each review uses a separate exact Rift snapshot containing the current integration base and immutable fetched worker refs. The reviewer verifies identities, ancestry, stack shape, complete diff, scope, unrelated/suspicious changes, acceptance criteria, and required checks.

Approval binds exact ordered commits and integration base. Reviewer rejection returns actionable findings to the original worker/workspace. Revision cycles are configurable, default one; every update requires a fresh review.

Reviewer tracked mutation fails the review invocation.

## Integration

Eligible independent tasks integrate in topological, creation, then task-ID order. Before each integration the coordinator evaluates the approved changes against the current integration base. A changed effective diff or conflict invalidates the old base binding.

The coordinator records Jujutsu operation/commit IDs and structurally checks unresolved conflicts. File text or command success alone cannot prove integration.

Conflicts return to the original worker in an assigned conflict-resolution workspace/context and require republishing and fresh review. Conflict cycles have a separate configurable budget, default one; exhaustion requires user attention while independent branches continue.

## Cleanup

Temporary refs are deleted with lease checks after terminal disposition. Successful workspaces remain until run end by default. Failed, forced, invalid, or escalated resources are retained under bounded diagnostic policy. Cleanup is idempotent, verifies Rift identity, never unregisters the source root, and reconciles stale refs/panes/workspaces after interruption.

This protocol depends on [DESIGN-herdr-rift-jj](DESIGN-herdr-rift-jj.md) and [SPEC-agent-protocol](SPEC-agent-protocol.md).

