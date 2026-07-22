# DESIGN-effect-event-sourcing: Effect and event-sourced orchestration

Status: confirmed, 2026-07-22, aivv

The coordinator uses Effect services/scopes and a pure event-sourced domain core. Each run persists an append-only JSONL event journal and derives state through a deterministic reducer.

## Rationale

Subagent orchestration crosses multiple non-transactional systems: Pi, Herdr, Rift, Jujutsu, Git, and the filesystem. A durable intent/outcome journal makes interrupted side effects observable and reconcilable. Pure decisions and reducers permit deterministic tests of graph, retry, cancellation, and recovery behavior without launching external tools.

One Effect scope per run isolates cancellation and defects. Nested attempt/reviewer scopes make resource ownership explicit. A priority queue preserves deterministic scheduling while semaphores enforce global, worker, and reviewer capacity.

Effect Schema is the runtime and TypeScript authority for configuration, commands, events, snapshots, envelopes, and artifacts. Independent versioned unions and pure migrations support recovery across package upgrades.

## Tradeoffs

JSONL is inspectable and simple but needs ordered append, checksums, snapshots, migration tests, and explicit corruption handling. It is not intended for cross-host distributed scheduling. A later SQLite implementation may replace the journal adapter without changing domain authority.

Event sourcing adds record and reducer design overhead. This is justified by crash recovery and audit requirements; it must not spread event mechanics into external adapters or UI rendering.

## Rejected alternatives

- Pi session custom entries alone do not provide sufficient independent durability or reconciliation authority.
- In-memory state cannot safely recover external resources.
- One global scheduler would couple run failures and cancellation.
- Executing then recording outcomes leaves ambiguous side effects after crashes.

This decision governs [ARCH-pi-subagents](ARCH-pi-subagents.md) and the recovery behavior in [SPEC-observability-recovery](SPEC-observability-recovery.md).

