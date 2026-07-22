# First slice: Single-task reviewed integration

## Problem Statement

The project has validated the overall architecture and external-tool composition, but it has no production implementation. The first implementation must prove the riskiest complete path without prematurely building decomposition, parallel scheduling, recovery, or the full UI.

The critical path is: a Pi user delegates one contained source edit; a Herdr-hosted worker performs it in an exact Rift snapshot; a separate reviewer either approves it or requests one revision; the coordinator validates exact Jujutsu identities and integrates the approved change into the source repository.

The prior disposable prototype proved this flow is feasible and exposed three mandatory safeguards: output artifacts must be ignored before launch, installed Herdr capabilities must be negotiated, and Jujutsu conflicts must be detected structurally rather than inferred from process success or file text.

## Desired Outcome

From a trusted Pi TUI session in a supported colocated Jujutsu/Git repository, the user can run:

```text
/subagents run <task>
```

The extension performs preflight, launches one worker and one reviewer through Herdr, allows at most one reviewer-requested revision by the original worker, automatically integrates an exact approved change, leaves a new empty source working copy on top of it, reports the semantic result, and cleans successful temporary resources.

The package is locally buildable, testable, packable, and installable as `@aivv/pi-subagents`, but this slice is not published.

## Invariants

- Project trust, TUI mode, compatible external capabilities, and model authentication are established before journal, Rift, transport, pane, or agent creation.
- The source is a colocated `jj`/Git repository on Linux btrfs. Current `@` is empty; assigned base is `@-` and must remain unchanged until integration.
- Herdr owns worker/reviewer process lifetime but never supplies semantic success.
- The worker and reviewer run in separate exact Rift snapshots; neither receives the coordinator source workspace.
- Child Pi built-ins and project resource discovery are disabled. A coordinator-owned child extension supplies guarded role tools.
- Agent reads remain within their Rift root. Worker tracked writes remain within task scope; reviewer tracked mutation is prohibited.
- The first slice exposes no general shell, network, hooks, arbitrary command approval, secrets, or upstream Git credentials.
- Every attempt uses versioned read-only input and atomic output artifacts under a pre-created ignored `.pi-subagents` area.
- One worker publishes exactly one non-empty described task change created fresh from the assigned base. The copied source working-copy change ID is forbidden.
- Exact result, fetched ref, review, and integration commit/base identities must agree.
- One reviewer rejection may return to the original worker; any update invalidates previous review and requires a fresh reviewer snapshot.
- Integration never proceeds when the source base drifted, an approval is stale, or `jj` reports a conflict.
- External mutations are preceded by durable intent and followed by observed outcome in an append-only JSONL journal.
- Failure never integrates unapproved work or deletes uncertain diagnostic resources.
- Successful integration is not rolled back because cleanup failed.

These invariants refine [ARCH-pi-subagents](../../specs/ARCH-pi-subagents.md), [DESIGN-effect-event-sourcing](../../specs/DESIGN-effect-event-sourcing.md), and [DESIGN-herdr-rift-jj](../../specs/DESIGN-herdr-rift-jj.md).

## User Stories

1. As a Pi user, I want to delegate one contained source edit, so that a separate agent can implement it without touching my source workspace directly.
2. As a Pi user, I want a dedicated reviewer to approve the exact worker revision, so that unreviewed or stale work cannot integrate.
3. As a Pi user, I want reviewer feedback returned once to the original worker, so that a deficient result can be corrected without restarting the whole run.
4. As a Pi user, I want concise semantic progress in Pi and raw terminals in Herdr, so that I can distinguish process activity from validation and integration.
5. As a Pi user, I want failures to retain exact diagnostic resources, so that protocol or external-tool problems remain inspectable.
6. As a package maintainer, I want a real disposable acceptance test and strict local package build, so that later slices extend a verified walking skeleton rather than a mock architecture.

## Requirements

### Package and composition

- [ ] Create the npm-ready package identity `@aivv/pi-subagents`, licensed `MIT OR Apache-2.0`, with compiled ESM loaded by Pi, corresponding TypeScript source, declarations, source maps, Pi manifest, child extension assets, schemas/prompts, licenses, and third-party notices.
- [ ] Treat Pi packages as peers and Effect as a production dependency, consistent with [REQ-external-runtime-distribution](../../specs/REQ-external-runtime-distribution.md).
- [ ] Make the package locally buildable, testable, packable, and installable through Pi without publishing or downloading external executables.
- [ ] Include a CLI entry-point placeholder if required by the final package manifest, but do not implement standalone doctor behavior.

### Command and preflight

- [ ] Register `/subagents run <task>` as the only run-start surface in this slice.
- [ ] Refuse empty task text without creating any durable or external resource.
- [ ] Refuse outside TUI mode before resource creation.
- [ ] Require Pi project trust before reading repository content or creating state.
- [ ] Verify the source is a colocated Jujutsu/Git repository on Linux btrfs, `@` is empty, and `@-` is a resolvable immutable assigned base.
- [ ] Verify Pi/Node, parent model authentication, Herdr, Rift, Jujutsu, and Git versions and required runtime capabilities. Herdr checks must inspect the installed protocol/schema rather than assume repository `next` documentation.
- [ ] Verify writable coordinator state paths and artifact-ignore capability.
- [ ] Allow only one active run for this project/session; reject a second start with the active run identity.
- [ ] Detect an unfinished prior journal at startup/start and report it as paused with resource locations and manual cleanup guidance. Do not resume or delete it.

### Durable single-run state

- [ ] Store coordinator journals and local transport state under `~/.pi/agent/state/pi-subagents/<repository-id>/`, where repository identity is stable and path-safe.
- [ ] Define versioned Effect Schemas for the slice’s run/task/attempt state, commands, events, worker/reviewer envelopes, results, review decisions, and redacted diagnostics.
- [ ] Append ordered JSONL events with run ID, sequence, event ID, timestamp, causation/correlation IDs, schema version, and typed payload.
- [ ] Record durable intent before each external mutation and observed outcome afterward.
- [ ] Derive displayed semantic state from a pure reducer; adapter callbacks may propose facts but may not mutate authoritative state directly.
- [ ] No queue, semaphore, decomposer, dynamic graph, snapshot compaction, migration beyond version-one decoding, or restart resume is required.

### Artifacts and child runtime

- [ ] Before launching an agent, create the attempt’s `.pi-subagents/runs/<run>/tasks/<task>/attempts/<attempt>/` input/output/evidence directories inside its Rift snapshot.
- [ ] Add and verify `/.pi-subagents/` in repository-local ignore/exclude state before writing outputs; prove with `jj` that artifact writes do not alter task commit IDs.
- [ ] Write a checksummed, read-only, versioned task envelope and require atomic output replacement with containment, size, regular-file, and symlink checks.
- [ ] Use final role envelope/output schema shapes from [SPEC-agent-protocol](../../specs/SPEC-agent-protocol.md), while instantiating only worker, reviewer, and revision-request behavior.
- [ ] Launch child Pi with built-ins and project extension/skill/prompt discovery disabled.
- [ ] Load only the coordinator-owned guarded child extension and built-in worker/reviewer prompts. Do not load global/project subagent configuration or specialization.
- [ ] Use the parent Pi session’s active model and compatible thinking level for worker and reviewer.
- [ ] Construct a minimal environment. Pi may internally resolve model authentication, but guarded tools must not expose credentials or parent secrets.
- [ ] Provide guarded read/search/edit/write tools and narrow Jujutsu identity/describe operations to the worker; provide guarded read/search/diff tools to the reviewer. Provide no general shell or network tool.

### Worker flow

- [ ] Initialize/verify Rift and create an exact `copyAll` snapshot with hooks disabled.
- [ ] Record the copied working-copy change ID, then create and record a fresh worker task change directly from assigned base before agent edits.
- [ ] Start a named Pi worker through Herdr only after the pane reports interactive readiness; do not race prompt submission with startup.
- [ ] Treat the full command text as task and acceptance guidance; do not invoke a decomposer.
- [ ] Require one non-empty described task change and reject stacks, merges, unrelated ancestry, forbidden copied change ID, out-of-scope paths, tracked artifacts, or missing/invalid output.
- [ ] A missing/invalid artifact may fail this slice directly; the separate result-repair role is deferred. The reviewer-revision budget must not be reused as protocol repair.
- [ ] Publish only the validated exact task change through a unique lease-protected temporary bookmark in the coordinator-owned local bare Git transport.
- [ ] Fetch and verify that the remote target equals the result artifact’s exact commit ID.

### Review and one revision

- [ ] Create a separate exact reviewer Rift snapshot containing the assigned base and fetched immutable worker ref.
- [ ] Require the reviewer to validate identity, ancestry, one-change shape, complete diff, task scope, unrelated/suspicious changes, and the explicit user request.
- [ ] Prohibit project command execution in this slice; reviewer checks use repository/diff inspection only.
- [ ] Verify reviewer tracked state is unchanged after review.
- [ ] Require a versioned review artifact bound to the exact worker commit and assigned integration base.
- [ ] On approval, proceed only if all exact bindings remain current.
- [ ] On the first `revision_requested`, return actionable findings to the original worker in its existing workspace, require it to amend the same change ID, republish with a lease, and create a fresh reviewer snapshot.
- [ ] On a second rejection, fail and retain worker/reviewer resources.

### Integration

- [ ] Immediately before integration, verify source `@` is still empty, source `@-` still equals assigned base, fetched commit/review bindings remain exact, and no Jujutsu conflict exists.
- [ ] If the base drifted or integration would conflict, stop without attempting rebase/resolution, retain resources, and report diagnostics.
- [ ] Integrate by fetching the approved commit and running the equivalent of `jj new <approved-commit>` in the source, producing a new empty source working copy on top of the approved task change.
- [ ] Record before/after Jujutsu operation IDs and verify the approved change is an ancestor of new `@` with no unresolved conflicts.
- [ ] Never copy worker files directly into the source workspace.

### UI, cancellation, and cleanup

- [ ] Display a compact active-run widget above the editor with phase and semantic status, plus bounded notifications and a terminal summary.
- [ ] Distinguish Herdr process state from result validation, review, and integration in every label.
- [ ] Do not implement the full `/subagents` overlay or attention queue.
- [ ] If worker/reviewer becomes blocked, notify, stop the run, retain resources, and identify the Herdr pane for manual inspection. Do not approve automatically or wait indefinitely.
- [ ] Support user/Escape cancellation: stop progression, request cooperative cancellation, send bounded `Ctrl+C` if needed, and retain resources whenever settlement/ownership is uncertain.
- [ ] After verified integration, delete temporary transport refs, close Herdr resources, remove worker/reviewer Rifts, and run/schedule Rift garbage collection.
- [ ] If cleanup succeeds, report `succeeded`.
- [ ] If integration succeeded but any cleanup step fails, report `succeeded_with_cleanup_warning`, preserve exact cleanup diagnostics, and do not roll back integration.
- [ ] Any pre-integration protocol, capability, base-drift, blocked-agent, external-tool, or conflict failure reports `failed`, integrates nothing, and retains diagnostic resources.

## Implementation Decisions

- Use the ports-and-adapters dependency direction in [ARCH-pi-subagents](../../specs/ARCH-pi-subagents.md), but implement only the ports needed by this vertical slice: journal, artifacts, guarded child runtime, Herdr, Rift, Jujutsu, Git transport, and process execution.
- Use Effect Schema as the single runtime/type authority and a pure reducer for the single-run state.
- Execute the flow directly inside one scoped run supervisor; do not build the future priority queue, role semaphores, run registry, decomposition graph, or recovery supervisor.
- Use Herdr CLI JSON for mutations/queries and only the minimum event/readiness mechanism supported by the installed protocol. Capability negotiation must isolate version-specific command shapes.
- Use Rift exact `copyAll` snapshots with hooks disabled and a guarded source-root policy.
- Use a local bare Git repository only as revision transport. Worker tools never receive a general Git push or remote-management capability.
- Use coordinator-global durable state and worker-local ignored artifacts as separate authority domains.
- Use built-in worker/reviewer prompts only. Configuration merge, role overrides, decomposer, repair, and conflict-resolver prompts remain uninstantiated.
- Define tagged errors sufficient to distinguish preflight, trust, protocol, blocked agent, cancellation, Herdr, Rift, Jujutsu, Git transport, integration conflict/base drift, and cleanup warning behavior.
- Treat numeric external versions observed in the prototype as test baselines, not declared minima. The slice’s supported minima are established by passing capability fixtures and recorded in package compatibility metadata before merge.

## Testing Decisions

- **Seam:** The highest stable public seam is `/subagents run <task>` in a trusted Pi TUI, with external systems behind typed Effect ports. Pure logic is tested through command/event/reducer and schema interfaces; adapter contracts are tested against disposable real repositories/processes; one full acceptance test exercises the public command.
- Schema tests cover strict decoding, identity mismatch, unknown fields, output containment, redaction, and atomic-artifact assumptions.
- Reducer tests cover the happy path, one rejection/revision, second rejection, cancellation, blocked agent, base drift, conflict, retained failure, successful cleanup, and cleanup warning.
- Guarded-tool tests attempt path traversal, symlink escape, metadata/credential access, out-of-scope writes, general process/network access, project resource loading, and reviewer mutation.
- Adapter contract tests use disposable colocated Jujutsu/Git repositories and verify fresh change IDs, exact refs/leases, structural conflicts, operation IDs, and source-root protection.
- Herdr fixtures cover installed-schema negotiation, unsupported capability failure, interactive readiness, blocked state, identity replacement, and bounded cancellation.
- Artifact regression test proves writing output cannot change the worker commit ID.
- Integration regression test proves conflict-marker text can never satisfy success while Jujutsu reports a conflict.
- The real disposable acceptance test runs on Linux btrfs with real Pi, Herdr, Rift, Jujutsu, and Git: the worker intentionally produces an edit the reviewer rejects, the original worker amends once, a fresh reviewer approves, the coordinator creates a new empty source `@` on the approved commit, and all successful temporary resources are cleaned.
- Package tests build compiled ESM, install the tarball into a clean Pi environment, verify one extension is discovered, and inspect tarball contents for prohibited external binaries/source, credentials, journals, or secrets.

## Expected Linked Specs deltas

- [ARCH-pi-subagents](../../specs/ARCH-pi-subagents.md): during implementation, describe the actually present single-run direct supervisor and identify broader run registry/decomposition/recovery components as not yet present rather than implying they exist.
- [SPEC-task-graph](../../specs/SPEC-task-graph.md): record the current one-task direct-execution subset and explicit absence of decomposition, dynamic tasks, queues, concurrency, and retries beyond one reviewer revision.
- [SPEC-agent-protocol](../../specs/SPEC-agent-protocol.md): record which final contracts are implemented in the slice (worker/reviewer) and that global/project specialization, decomposer, result-repair, and conflict-resolver execution are not yet supported.
- [SPEC-change-integration](../../specs/SPEC-change-integration.md): record one-change-only publication, empty-`@` base precondition, immediate successful cleanup, and fail/retain behavior for conflict instead of conflict resolution.
- [SPEC-observability-recovery](../../specs/SPEC-observability-recovery.md): record widget/notification/summary behavior and the paused-journal/manual-cleanup limitation; full overlay, RPC, and recovery are not yet available.
- [SPEC-trust-permissions](../../specs/SPEC-trust-permissions.md): record the implemented no-shell guarded capability subset and lack of interactive command/network expansion.
- [REQ-external-runtime-distribution](../../specs/REQ-external-runtime-distribution.md): no requirement change; implementation evidence should add tested compatibility facts without weakening external-install or release obligations.
- [DESIGN-effect-event-sourcing](../../specs/DESIGN-effect-event-sourcing.md) and [DESIGN-herdr-rift-jj](../../specs/DESIGN-herdr-rift-jj.md): no decision change expected.

Linked Specs must be updated in the implementing change so that they describe the actually shipped subset and any explicit temporary exceptions, while preserving the confirmed architectural decisions.

## Out of Scope

- Automatic decomposition or worker-proposed tasks
- Multiple tasks, parallel DAGs, queues, semaphores, or concurrent runs
- Execution retries or result-artifact repair
- General shell commands, project checks, command approval UI, network exceptions, secrets, hooks, or upstream credentials
- Integration conflict resolution or automatic rebase
- Multi-change stacks
- Project/global role configuration and specialization
- Full `/subagents` overlay, attention dialogs, retained-resource manager, or RPC mode
- Restart reconciliation/resume, snapshot compaction, or automatic cleanup of unfinished journals
- `/subagents doctor` and functional standalone doctor CLI
- macOS, non-btrfs Linux, or broader compatibility matrix
- npm/Git publication
- Stable release readiness

## Open Questions and Assumptions

- No blocking product decisions remain.
- Assumption: the acceptance environment provides valid Pi model authentication usable by child Pi without exposing credentials to guarded tools.
- Assumption: Linux btrfs is available for the real acceptance test; other Rift-supported filesystems are deliberately unsupported in this slice.
- Assumption: capability-test evidence will establish exact minimum external versions before merge; implementation must not guess version ranges.
- Assumption: the user task can be completed and reviewed using guarded filesystem/search/diff tools without project command execution.
