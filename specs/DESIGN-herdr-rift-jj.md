# DESIGN-herdr-rift-jj: Herdr-hosted Rift snapshots with Jujutsu change transport

Status: confirmed, 2026-07-22, aivv

Workers and reviewers run as interactive Pi subprocesses hosted by Herdr. Worker filesystems are exact Rift snapshots containing independent colocated Jujutsu repositories. Reviewed revisions move through a coordinator-owned local bare Git repository and are integrated by the coordinator with Jujutsu.

## Rationale

Herdr provides persistent real terminals, agent visibility, attention state, and user inspection. Making it authoritative for process hosting satisfies the product goal; Effect remains authoritative for semantic scheduling and results.

Rift provides fast copy-on-write snapshots including ignored dependencies when `copyAll` is enabled. Rift does not create shared Jujutsu workspaces. Treating each snapshot as an independent repository and using explicit Git transport avoids unsupported `.jj` metadata surgery.

The worker creates a fresh Jujutsu task change from the assigned base because an exact snapshot duplicates the source working-copy change ID. Temporary bookmark transport preserves commit/change identity while keeping upstream credentials away from workers.

The current worker runtime invokes only fixed-argv `rift init` and `rift create <source> --into <destination> --name <attempt> --copy-all --no-hooks`; it never calls a Rift source-removal operation. It starts named child Pi processes through Herdr, verifies the returned pane identity and `idle` readiness before sending a prompt, and treats a later `blocked` status as retained attention rather than success.

The current transport implementation creates a bare `transport.git` under coordinator state, disables its hooks, and uses a coordinator-owned named Jujutsu remote only. It observes the exact attempt ref before push, relies on Jujutsu's fetched-remote lease check, refuses a pre-existing attempt ref, verifies the bare target immediately after push, then fetches and rechecks exact commit/change/base identity in the coordinator repository. Neither child role receives this transport capability.

## Tradeoffs

Independent repositories lose shared Jujutsu operation history and require explicit publication, fetch, lease, and cleanup. Approved parallel revisions may conflict when integrated against a newer base, so changed effective diffs require conflict resolution and fresh review.

Herdr process hosting is less directly typed than in-process Pi SDK sessions and requires capability negotiation against the installed Herdr protocol. The read-only preflight decodes the local schema header and requires the exact operations needed by the supported flow; it does not infer support from repository `next` documentation or a version range. Structured artifacts and repository checks, not terminal scraping, compensate for this boundary.

## Rejected alternatives

- In-process Pi SDK workers do not appear as Herdr-managed terminal agents.
- Copying a `.jj` repository is not `jj workspace add` and cannot be treated as shared state.
- Replacing copied `.jj` metadata with a workspace pointer is unsupported.
- Terminal output and Herdr `done`/`idle` cannot prove semantic completion.

This decision is realized by [SPEC-agent-protocol](SPEC-agent-protocol.md) and [SPEC-change-integration](SPEC-change-integration.md).
