# Choose Effect architecture and module boundaries

**Type:** grilling  
**Status:** closed  
**Blocked by:** [Research Pi extension orchestration boundaries](research-pi-extension-orchestration.md), [Research Rift workspace lifecycle](research-rift-workspace-lifecycle.md), [Research Herdr coordination primitives](research-herdr-coordination-primitives.md), [Validate Rift and Jujutsu composition](prototype-rift-jj-composition.md), [Choose worker hosting and Herdr boundary](choose-worker-hosting.md), [Determine Herdr licensing and distribution constraints](research-herdr-licensing.md), [Define task graph and execution semantics](define-task-graph-semantics.md), [Define isolated change and integration protocol](define-integration-protocol.md)

## Question

Which Effect services, layers, scopes, queues, supervision policies, typed errors, persistence boundaries, and external adapters should implement the agreed orchestration semantics?

## Resolution

### Architectural style

Use a ports-and-adapters architecture with a pure event-sourced domain core and Effect services around it.

```text
Pi extension adapter
        |
Application: RunRegistry / RunSupervisor / DispatchCoordinator
        |
Domain: commands -> decide -> events -> reduce -> RunState
        |
Ports: Journal, Herdr, Rift, Jj, GitTransport, ArtifactStore, Clock, IDs
        |
Adapters: filesystem JSONL, Herdr CLI/socket, command-backed Rift/jj/git
```

Dependency direction points inward. Domain modules import Effect data/schema utilities where useful but never Pi, Herdr, Rift, process, filesystem, or TUI APIs.

### Package and module boundaries

```text
src/
  domain/
    ids.ts               branded opaque IDs
    task-graph.ts        graph invariants and readiness
    state.ts             RunState / TaskState / AttemptState
    command.ts           versioned domain commands
    event.ts             versioned domain events
    decide.ts            pure command decisions
    reduce.ts            pure event reducer
    policy.ts            retry, concurrency, retention, limits
    artifact.ts          worker/reviewer contracts
    error.ts             domain tagged errors
  application/
    run-registry.ts      active/recoverable run lookup
    run-supervisor.ts    one scoped fiber per active run
    dispatcher.ts        priority scheduling and capacity leases
    recovery.ts          replay, reconcile, confirmation gate
    reconciliation.ts    compare journal intent with external facts
    retention.ts         retained diagnostic resource ownership
  ports/
    journal.ts
    herdr.ts
    rift.ts
    jj.ts
    git-transport.ts
    artifact-store.ts
    command-runner.ts
  adapters/
    journal-jsonl.ts
    herdr-cli.ts
    herdr-events-socket.ts
    rift-command.ts
    jj-command.ts
    git-command.ts
    filesystem-artifacts.ts
    node-command-runner.ts
  extension/
    index.ts             Pi ExtensionAPI composition root
    commands.ts
    tools.ts
    ui.ts
  schemas/
    v1/                  public serialized schema exports
```

`extension/` is the only module aware of Pi extension types. Adapters return domain/application DTOs and typed errors rather than raw process output.

### Schema and serialization authority

- Effect Schema is the single authority for runtime validation and inferred TypeScript types.
- Commands, events, snapshots, worker results, reviewer results, and adapter protocol DTOs use explicit versioned discriminated unions.
- Serialized records include `schemaVersion`; migrations are pure, ordered, and tested from every supported version to current.
- Pi/TypeBox parameter schemas are boundary adapters generated from or checked against Effect schemas; they do not become domain authority.
- Sensitive fields have schema annotations/redaction functions used by logs, diagnostics, and UI rendering.

### Event-sourced run state

Each run has an append-only JSONL journal in a project-local trusted state directory outside worker-controlled paths. The journal is the durable source of truth.

- Every record has run ID, monotonic sequence, event ID, timestamp, schema version, causation ID, correlation ID, and typed payload.
- `RunState` is derived only by replaying events through the pure reducer.
- Writes use append, flush, and durability boundaries before dependent external action proceeds.
- A per-run append mutex preserves order; optimistic expected-sequence checks reject stale writers.
- Periodic versioned snapshots cache reduced state after a configurable event threshold. The full event log is retained for audit and migrations.
- Snapshot validity is bound to the covered event sequence and checksum; invalid snapshots fall back to full replay.

### Side-effect protocol

External mutations follow intent/outcome/reconciliation:

1. decide a domain command and append an intent event containing a stable idempotency key;
2. execute the port operation with that key or deterministic resource identity;
3. inspect authoritative external state;
4. append observed success/failure facts;
5. reduce and schedule the next command.

Adapters must make create/remove/publish operations idempotent where the external tool permits it. Where native idempotency is absent, deterministic IDs plus pre/post-condition queries provide at-least-once reconciliation without blind repetition.

No in-memory state transition is authoritative until its event is durably appended.

### Supervision and concurrency

- `RunRegistry` is a lightweight shared service mapping run IDs to active `RunSupervisor` handles and recoverable journal metadata.
- Each active run has one scoped `RunSupervisor` fiber. A run failure does not interrupt sibling runs.
- Each supervisor owns a priority queue of ready dispatch candidates. Priority is downstream-unlock count, creation order, then task ID.
- Queue consumers revalidate current graph readiness and terminal state because queued candidates can become stale.
- Effect semaphores enforce global active-agent capacity plus separate worker and reviewer capacity. Capacity acquisition order is globally fixed to avoid deadlock.
- Reviewer reservation prevents worker saturation from starving review.
- Forked attempt/reviewer fibers are supervised within the run scope and report outcomes as events; expected typed failures do not crash the supervisor.
- Invariant defects terminate that run supervisor, append a best-effort fatal diagnostic, stop new dispatch, and trigger reconciliation/cleanup.

### Resource scopes

One attempt scope owns:

- Rift worker workspace;
- Herdr workspace/tab/pane identity and event subscription;
- temporary transport bookmark lease;
- artifact paths and process timers;
- concurrency permits.

Reviewer invocations use equivalent independent scopes. Finalizers are idempotent and execute in reverse acquisition order.

When policy retains a successful or diagnostic resource, the attempt finalizer records and hands its deterministic resource identity to `RetentionRegistry` instead of deleting it. The run-level retention scope then owns eventual end-of-run or policy-driven cleanup. Ownership is explicit in journal events; there is never implicit leaked ownership.

### External ports

- `HerdrClient`: CLI JSON for commands and point queries; raw local socket only for subscriptions and snapshots. It validates installed version/protocol before any Rift creation.
- `RiftClient`: command-backed init/create/list/ancestors/remove/gc with a project/run-specific database policy and marker validation.
- `JjClient`: structured template output for repository facts, change/bootstrap validation, conflict checks, operation IDs, and coordinator integration.
- `GitTransport`: owns the coordinator-local bare remote, restricted bookmark publication, fetch, lease checks, and ref deletion.
- `ArtifactStore`: atomic contained writes/reads, symlink escape rejection, checksums, and Effect Schema decoding.
- `CommandRunner`: private low-level process execution with argv arrays, cwd/env allowlists, timeout, cancellation, bounded capture, and redacted diagnostics.

No application service constructs shell command strings.

### Tagged failure families

Use tagged error families with structured context:

- `ValidationError`, `GraphInvariantError`, `ArtifactProtocolError`
- `JournalIoError`, `JournalConflictError`, `MigrationError`
- `HerdrUnavailableError`, `HerdrProtocolError`, `AgentBlockedError`, `AgentTimeoutError`
- `RiftUnsupportedError`, `RiftIdentityError`, `RiftLifecycleError`
- `JjStateError`, `RevisionValidationError`, `IntegrationConflictError`
- `GitTransportError`, `RefLeaseError`
- `CancellationTimeoutError`, `CleanupError`, `ReconciliationError`

Retry/escalation/cleanup policy pattern-matches these tags exhaustively. Unexpected exceptions, impossible reducer states, and programmer errors are defects, not converted into ordinary task failures.

### Recovery

On Pi/extension startup:

1. discover unfinished run journals;
2. validate/migrate events and load the newest valid snapshot;
3. replay to current state;
4. query Herdr snapshot, Rift registry/markers, Git refs, `jj` state, and artifacts;
5. append reconciliation facts for drift without dispatching new work;
6. present a recovery summary and require user confirmation;
7. on confirmation, create a new run scope and resume only idempotently safe commands;
8. otherwise leave the run paused or cancel/clean it by explicit user choice.

In-flight waits and subscriptions are never assumed to survive. Reconnect from Herdr `session.snapshot`, then subscribe. A side effect with intent but no outcome is queried before retry.

### Configuration and composition

The extension composition root constructs Effect `Layer`s in this order:

```text
Node runtime/config/logging
  -> command/filesystem adapters
  -> Herdr/Rift/Jj/Git/Journal/Artifact layers
  -> application services
  -> Pi command/tool/UI adapter
```

Project configuration is loaded only after Pi project-trust validation, decoded with Effect Schema, merged with safe global defaults, and frozen per run. Secrets and upstream Git credentials are not inherited by worker adapters unless explicitly required by a later trusted policy.

## Map

[Effect-based Pi subagent orchestration](README.md)

## Unlocks

- [Prototype one parallel orchestration cycle](prototype-parallel-cycle.md)
