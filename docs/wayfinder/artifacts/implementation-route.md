# Implementation route

The following backlog is dependency-ordered and sized for implementation/review. Each task should produce a focused change with tests and cite the governing Linked Specs where non-obvious.

## Milestone 1: Package and pure domain foundation

### 1. Scaffold `@aivv/pi-subagents`

Create package metadata, TypeScript/ESM build, Effect dependency, Pi peer dependencies, source/dist layout, dual licenses, notices, test runner, and npm tarball allowlist.

Acceptance: clean install/build/test; `npm pack --dry-run` contains only intended source/dist/assets/licenses; Pi discovers exactly one extension.

Governing: [REQ-external-runtime-distribution](../../../specs/REQ-external-runtime-distribution.md), [ARCH-pi-subagents](../../../specs/ARCH-pi-subagents.md).

### 2. Define branded IDs and versioned schemas

Implement Effect Schemas for configuration, IDs, commands, events, snapshots, task graph, all role envelopes/outputs, and redaction.

Acceptance: round-trip/property tests; strict unknown-field behavior; malformed/untrusted fixture coverage; independent role versions.

Depends on: 1. Governing: [SPEC-agent-protocol](../../../specs/SPEC-agent-protocol.md), [DESIGN-effect-event-sourcing](../../../specs/DESIGN-effect-event-sourcing.md).

### 3. Implement pure task-graph state machine

Implement graph validation, dynamic proposal admission, state transitions, readiness, deterministic priority, retry/block/cancel/run terminal decisions, and reducers.

Acceptance: table/property tests cover cycles, causal blocking, stale candidates, all terminal states, and deterministic replay.

Depends on: 2. Governing: [SPEC-task-graph](../../../specs/SPEC-task-graph.md).

### 4. Implement pure revision/review decisions

Model attempt ownership, revision stacks, publication/review bindings, revision/conflict budgets, integration eligibility/order, and retention ownership events.

Acceptance: stale commit/base approvals are impossible to integrate; transition/property tests cover rejection, conflict, cancellation, and cleanup ownership.

Depends on: 2–3. Governing: [SPEC-change-integration](../../../specs/SPEC-change-integration.md).

## Milestone 2: Durable runtime substrate

### 5. Implement JSONL journal and snapshots

Add ordered append/flush, expected-sequence conflict, checksums, replay, corruption diagnostics, snapshots, and migration registry.

Acceptance: crash/truncation fixtures, concurrent append rejection, snapshot fallback, previous-two-version migrations, deterministic state hashes.

Depends on: 2–4. Governing: [DESIGN-effect-event-sourcing](../../../specs/DESIGN-effect-event-sourcing.md).

### 6. Implement secure command runner

Add argv-only process execution with cwd/env construction, timeout/interruption, bounded/redacted output, executable identity, and typed failures.

Acceptance: no shell interpolation; process-tree cancellation tests; output limits; environment leak tests; tagged-error mapping.

Depends on: 2. Governing: [SPEC-trust-permissions](../../../specs/SPEC-trust-permissions.md).

### 7. Implement artifact store

Create ignored contained attempt directories, atomic input/output operations, canonical/symlink checks, permissions, checksums, schema decoding, evidence limits, and tracked-state verification hooks.

Acceptance: traversal/symlink/TOCTOU-oriented fixtures; `jj` confirms artifact paths untracked; commit IDs remain stable after artifact writes.

Depends on: 2, 6. Governing: [SPEC-agent-protocol](../../../specs/SPEC-agent-protocol.md), [SPEC-trust-permissions](../../../specs/SPEC-trust-permissions.md).

## Milestone 3: External adapters and doctor

### 8. Implement Jujutsu and Git transport adapters

Add structured `jj` templates/revsets for bases, changes, paths, conflicts, operation IDs, bootstrap, and integration. Add local bare transport, restricted temporary refs, leases, fetch, and cleanup.

Acceptance: disposable colocated repos cover fresh change IDs, stacks, stale refs, divergent copied IDs, conflicts, deterministic integration, and no upstream push.

Depends on: 6–7. Governing: [DESIGN-herdr-rift-jj](../../../specs/DESIGN-herdr-rift-jj.md), [SPEC-change-integration](../../../specs/SPEC-change-integration.md).

### 9. Implement Rift adapter

Add capability detection, init/create with exact copy and hooks disabled, identity/ancestry/list/remove/gc, custom database handling, and source-root guard.

Acceptance: supported btrfs/reflink fixtures; hook prohibition; create-failure reconciliation; idempotent removal; source root cannot be unregistered.

Depends on: 6. Governing: [DESIGN-herdr-rift-jj](../../../specs/DESIGN-herdr-rift-jj.md), [SPEC-trust-permissions](../../../specs/SPEC-trust-permissions.md).

### 10. Implement Herdr adapters

Use CLI JSON for mutations/queries and socket snapshot/subscriptions for events. Generate/decode installed schema capabilities, model startup readiness, identity pinning, reconnect, and focus.

Acceptance: tested minimum/current Herdr fixtures; old/new command-shape negotiation; prompt-before-ready race prevented; moved/replaced panes cannot satisfy old waits.

Depends on: 6. Governing: [ARCH-pi-subagents](../../../specs/ARCH-pi-subagents.md), [SPEC-observability-recovery](../../../specs/SPEC-observability-recovery.md).

### 11. Implement shared doctor service and CLI

Check Pi/Node/Herdr/Rift/`jj`/Git versions and capabilities, platform/filesystem, trust/state paths, and journal migration compatibility. Expose `pi-subagents doctor --json`.

Acceptance: read-only behavior; machine/human outputs derive from one schema; each missing capability has remediation; no resources created.

Depends on: 8–10. Governing: [REQ-external-runtime-distribution](../../../specs/REQ-external-runtime-distribution.md).

## Milestone 4: Guarded child agent runtime

### 12. Implement child Pi extension and permission engine

Disable built-ins/project discovery and register role-specific guarded file/search/process/Jujutsu/artifact tools. Implement path, environment, command fingerprint, network, secret, metadata, and role policy.

Acceptance: adversarial tests for path escape, symlinks, shell/interpreter bypasses, environment/credential reads, unauthorized refs, reviewer writes, and stale approvals; fail closed.

Depends on: 2, 6–10. Governing: [SPEC-trust-permissions](../../../specs/SPEC-trust-permissions.md).

### 13. Implement role prompts and envelopes

Ship layered built-in prompts, trusted contained specialization loader, model/tool resolution, all role envelope/output builders, completion marker parser, and repair proof.

Acceptance: authority ordering tests, prompt-injection fixtures, size/provenance checks, model fallback/explicit failure, output migrations, repair cannot change task revisions.

Depends on: 2, 7, 12. Governing: [SPEC-agent-protocol](../../../specs/SPEC-agent-protocol.md).

## Milestone 5: Orchestration application

### 14. Implement run supervisor and dispatch coordinator

Build run registry, scoped supervisor, priority queue, worker/reviewer/global semaphores, candidate revalidation, intent/outcome effects, retries, blocked attention, cancellation, and resource scopes.

Acceptance: deterministic fake-adapter tests for two runs, capacity, reviewer reservation, defects vs typed failure, cancellation escalation, and retention transfer.

Depends on: 3–7. Governing: [ARCH-pi-subagents](../../../specs/ARCH-pi-subagents.md), [SPEC-task-graph](../../../specs/SPEC-task-graph.md).

### 15. Implement worker/publication/review loop

Wire Rift bootstrap, child Pi launch, artifact validation/repair, local ref publication/fetch, separate reviewer snapshots, bounded revision, and stale-approval invalidation.

Acceptance: automated prototype equivalent covers concurrent workers, rejection, same-worker revision, exact approval, and cleanup.

Depends on: 8–10, 12–14. Governing: [SPEC-agent-protocol](../../../specs/SPEC-agent-protocol.md), [SPEC-change-integration](../../../specs/SPEC-change-integration.md).

### 16. Implement deterministic integration and conflicts

Re-evaluate effective diffs against current base, integrate structurally, detect `jj` conflicts, route conflict resolution to original worker, require fresh review, and enforce budgets.

Acceptance: same-file parallel fixture reproduces and resolves the prototype conflict; substring/exit-code false success is impossible; operation IDs journaled.

Depends on: 15. Governing: [SPEC-change-integration](../../../specs/SPEC-change-integration.md).

### 17. Implement recovery and reconciliation

Discover journals, migrate/replay, query external resources, resolve intents without outcomes, classify drift, keep paused, resume after confirmation, and perform idempotent cleanup.

Acceptance: kill/restart injection at every external intent/outcome boundary; no duplicate agents/refs/workspaces; unsupported newer journal never rewritten.

Depends on: 5, 8–10, 14–16. Governing: [SPEC-observability-recovery](../../../specs/SPEC-observability-recovery.md).

## Milestone 6: Pi parent extension and release

### 18. Implement Pi commands, tool, and semantic UI

Register orchestration tool, `/subagents` command family, active widget/status, overlays, attention dialogs, recovery view, Herdr focus, retained-resource controls, concise tool rendering, and RPC equivalents.

Acceptance: TUI width/theme/keyboard/IME tests; no focus stealing; exact destructive confirmations; RPC parity; print/JSON refuse before resource creation; Herdr settlement never renders semantic success.

Depends on: 11, 14–17. Governing: [SPEC-observability-recovery](../../../specs/SPEC-observability-recovery.md).

### 19. Complete documentation and security operations

Write install/doctor/configuration/role/trust/recovery/cleanup/troubleshooting docs, compatibility matrix, license boundary, threat limitations, SECURITY.md, and support policy.

Acceptance: docs examples validated in CI; external installs only; no claim of hardened sandbox; commercial/hosted limitations explicit.

Depends on: 11–18. Governing: [REQ-external-runtime-distribution](../../../specs/REQ-external-runtime-distribution.md), [SPEC-trust-permissions](../../../specs/SPEC-trust-permissions.md).

### 20. Build support-matrix acceptance and release pipeline

Automate clean Pi package install, doctor parity, reducer/migrations, adversarial child policy, Herdr/Rift/`jj` end-to-end flows, Linux/macOS supported paths, tarball/license/SBOM/provenance checks, and prerelease publication.

Acceptance: `next` release is reproducible from signed tag; tarball excludes every prohibited payload; minimum and latest-supported tuples pass; failure blocks publish.

Depends on: 1–19. Governing: [REQ-external-runtime-distribution](../../../specs/REQ-external-runtime-distribution.md).

## Route completion criteria

The destination is reached when tasks 1–20 satisfy their acceptance conditions and all governing Linked Specs agree with code/tests/docs. Stable `1.0.0` remains a later release decision after operational experience; it is not required for the first working destination.

