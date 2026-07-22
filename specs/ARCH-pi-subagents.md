# ARCH-pi-subagents: Pi subagent orchestration architecture

`@aivv/pi-subagents` is a TypeScript Pi extension for reviewer-controlled, isolated subagent orchestration. Its current package registers the TUI-only `/subagents run <task>` command surface and provides the event-sourced foundation for one direct worker/reviewer run; preflight and external orchestration are not connected to that command yet, so a syntactically valid command creates no resources.

## Boundaries

The system has five inward-pointing layers. The current foundation implements the domain core, JSONL journal adapter, and single-run registry; future adapters and coordination remain outside the current executable surface.

1. **Pi adapter** registers commands/tools and renders semantic state. It does not own orchestration decisions.
2. **Application services** claim one active direct run and will supervise it, dispatch ready work, reconcile resources, and apply policies as those behaviors are added.
3. **Domain core** decides commands, emits events, and reduces events into run/task/attempt state without importing Pi, Herdr, Rift, process, filesystem, or TUI APIs.
4. **Ports** describe journals, artifacts, Herdr, Rift, Jujutsu, Git transport, clocks, IDs, and process execution.
5. **Adapters** implement ports with JSONL/filesystem storage, Herdr CLI/socket APIs, and command-backed Rift, `jj`, and Git clients.

The package also contains a coordinator-owned child Pi extension. Child Pi starts with built-in tools and project resource discovery disabled; this extension exposes guarded role capabilities.

## Runtime ownership

`SingleRunRegistry` admits one active run and rejects a second with the active run ID. The direct-run state reducer owns the semantic worker/reviewer lifecycle and mutation intent/outcome facts. No dispatcher, capacity lease, RunSupervisor fiber, external resource scope, or retained-resource registry exists yet.

Resources have exactly one journaled owner. Retention transfers cleanup responsibility from an attempt scope to the run retention registry; it never silently suppresses cleanup.

## Control and data flow

The current domain flow is one task: creation, worker result, reviewer approval or one revision request, integration, and cleanup. It derives cancellation, blocked-agent, protocol-failure, and cleanup-warning outcomes from validated journal events. No decomposer, DAG, scheduler, Rift, Herdr, Jujutsu, Git transport, or artifact adapter exists yet.

## Persistence and recovery

Each run has an append-only, fsynced version-one JSONL event journal under `~/.pi/agent/state/pi-subagents/<repository-id>/runs/`. Effect Schema defines direct-run commands, event records, and derived state; journal records decode strictly, while a pure reducer rejects mismatched IDs, non-contiguous sequences, duplicate event IDs, illegal state transitions, and unmatched external outcomes.

External mutations are represented by durable intent and observed-outcome events. Startup can report unfinished journals as paused with manual-cleanup guidance; it neither resumes, reconciles, snapshots, migrates, nor deletes them.

## Trust boundaries

- Project trust is required before reading project orchestration configuration or creating resources.
- Herdr is a separately installed external process; it supplies process hosting and telemetry, not semantic success.
- Worker/reviewer content and repository text are untrusted data.
- IDs, artifacts, journal events, and repository facts are authority; terminal text, pane labels, and Herdr settlement are not.
- Workers have no upstream Git credentials, general secrets, implicit hooks, or default network access.

Behavior is specified by [SPEC-task-graph](SPEC-task-graph.md), [SPEC-agent-protocol](SPEC-agent-protocol.md), [SPEC-change-integration](SPEC-change-integration.md), [SPEC-trust-permissions](SPEC-trust-permissions.md), and [SPEC-observability-recovery](SPEC-observability-recovery.md).

The major architectural choices are recorded in [DESIGN-effect-event-sourcing](DESIGN-effect-event-sourcing.md) and [DESIGN-herdr-rift-jj](DESIGN-herdr-rift-jj.md). Distribution is constrained by [REQ-external-runtime-distribution](REQ-external-runtime-distribution.md).
