# ARCH-pi-subagents: Pi subagent orchestration architecture

`@aivv/pi-subagents` is a TypeScript Pi extension whose Effect runtime coordinates automatic task decomposition, Herdr-hosted Pi subprocesses, Rift-isolated repositories, reviewer-controlled change integration, recovery, and cleanup. Its currently shipped package registers the TUI-only `/subagents run <task>` command surface; until preflight and orchestration are present, a syntactically valid command reports that orchestration is unavailable and creates no resources.

## Boundaries

The system has five inward-pointing layers:

1. **Pi adapter** registers commands/tools and renders semantic state. It does not own orchestration decisions.
2. **Application services** supervise runs, dispatch ready work, reconcile resources, and apply policies.
3. **Domain core** decides commands, emits events, and reduces events into run/task/attempt state without importing Pi, Herdr, Rift, process, filesystem, or TUI APIs.
4. **Ports** describe journals, artifacts, Herdr, Rift, Jujutsu, Git transport, clocks, IDs, and process execution.
5. **Adapters** implement ports with JSONL/filesystem storage, Herdr CLI/socket APIs, and command-backed Rift, `jj`, and Git clients.

The package also contains a coordinator-owned child Pi extension. Child Pi starts with built-in tools and project resource discovery disabled; this extension exposes guarded role capabilities.

## Runtime ownership

A shared run registry owns one scoped `RunSupervisor` fiber per active run. A run scope owns its priority dispatcher, capacity leases, journal handle, reconciliation state, and retained-resource registry. Attempt and review scopes own their Herdr pane, Rift workspace, artifact area, temporary transport ref, timers, and subscriptions.

Resources have exactly one journaled owner. Retention transfers cleanup responsibility from an attempt scope to the run retention registry; it never silently suppresses cleanup.

## Control and data flow

The parent Pi command accepts a goal. A decomposer produces a candidate DAG, which the coordinator validates before any workspace creation. Ready tasks are scheduled under global and role-specific capacity limits.

For each worker attempt, the coordinator creates an exact Rift snapshot, creates a fresh Jujutsu task change, writes a versioned input envelope, and starts Pi in a Herdr pane. The worker writes a versioned ignored output artifact. The coordinator validates it against repository state and publishes the exact revision to a coordinator-owned local bare Git transport.

A reviewer runs in a separate Rift snapshot and returns an exact commit-bound decision. Only approved commits may enter deterministic coordinator integration. Rejections and conflicts return to the original worker under bounded revision policies.

## Persistence and recovery

Each run has an append-only versioned JSONL event journal. Pure reducers derive state. Periodic versioned snapshots accelerate replay but never replace the event history.

External mutations use durable intent, idempotent execution, observed outcome, and reconciliation. Startup recovery replays journals, reconciles Herdr/Rift/Git/`jj`/artifact facts, and requires user confirmation before dispatch resumes.

## Trust boundaries

- Project trust is required before reading project orchestration configuration or creating resources.
- Herdr is a separately installed external process; it supplies process hosting and telemetry, not semantic success.
- Worker/reviewer content and repository text are untrusted data.
- IDs, artifacts, journal events, and repository facts are authority; terminal text, pane labels, and Herdr settlement are not.
- Workers have no upstream Git credentials, general secrets, implicit hooks, or default network access.

Behavior is specified by [SPEC-task-graph](SPEC-task-graph.md), [SPEC-agent-protocol](SPEC-agent-protocol.md), [SPEC-change-integration](SPEC-change-integration.md), [SPEC-trust-permissions](SPEC-trust-permissions.md), and [SPEC-observability-recovery](SPEC-observability-recovery.md).

The major architectural choices are recorded in [DESIGN-effect-event-sourcing](DESIGN-effect-event-sourcing.md) and [DESIGN-herdr-rift-jj](DESIGN-herdr-rift-jj.md). Distribution is constrained by [REQ-external-runtime-distribution](REQ-external-runtime-distribution.md).
