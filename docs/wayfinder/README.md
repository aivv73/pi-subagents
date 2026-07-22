# Map: Effect-based Pi subagent orchestration

**Type:** map  
**Status:** closed

## Destination

A Pi extension automatically decomposes a user task into parallel subtasks, coordinates subagents through Herdr, isolates their work with Rift-managed `jj` workspaces, and uses a reviewer subagent to approve integration or return work for bounded revision.

## Notes

- The implementation language and runtime are TypeScript and Effect.
- Decomposition and dispatch are automatic; conflicts and failures may require user intervention.
- A dedicated reviewer subagent controls integration. Rejected work returns to the original subagent for a bounded retry and re-review.
- oh-my-pi is design inspiration only; compatibility with its configuration or APIs is not required.
- This map finds the implementation route. It does not implement the extension.

## Decisions so far

- [Research Pi extension orchestration boundaries](research-pi-extension-orchestration.md) — Use a thin Pi extension and explicitly constrain worker cwd, tools, resources, cancellation, and cleanup; its initial SDK-worker recommendation was superseded by the hosting decision.
- [Research Rift workspace lifecycle](research-rift-workspace-lifecycle.md) — Rift snapshots directories but does not create shared `jj` workspaces or integrate revisions; the composition requires validation.
- [Research Herdr coordination primitives](research-herdr-coordination-primitives.md) — Herdr can host and observe interactive agent processes, but semantic scheduling, structured results, retries, and reviewer authority remain Effect responsibilities.
- [Validate Rift and Jujutsu composition](prototype-rift-jj-composition.md) — Use independent exact Rift snapshots with fresh task change IDs and an explicit coordinator-owned local Git transport; integrate fetched reviewed commits with normal `jj` conflict semantics.
- [Choose worker hosting and Herdr boundary](choose-worker-hosting.md) — Herdr-hosted Pi subprocesses are authoritative; workers return validated versioned JSON artifacts, and orchestration fails early when Herdr is unavailable.
- [Determine Herdr licensing and distribution constraints](research-herdr-licensing.md) — Treat stock Herdr as a separately installed external executable accessed only through public CLI/socket protocols; bundling, modification, linking, and commercial/hosted scenarios require renewed license review.
- [Define task graph and execution semantics](define-task-graph-semantics.md) — The coordinator owns a validated dynamic DAG, admits safe worker-proposed tasks, schedules by downstream impact under separate/global caps, and uses bounded retries, causal blocking, and cooperative cancellation.
- [Define isolated change and integration protocol](define-integration-protocol.md) — Bind isolated attempts, publications, reviews, and deterministic integration to exact IDs; allow one change by default or bounded stacks, require separate reviewer snapshots, and return conflicts to the worker for bounded re-review.
- [Choose Effect architecture and module boundaries](choose-effect-architecture.md) — Use a pure event-sourced domain core, one scoped supervisor per run, Effect Schema contracts, priority queues plus semaphores, intent/outcome journaling, and typed Herdr/Rift/`jj`/Git adapters.
- [Prototype one parallel orchestration cycle](prototype-parallel-cycle.md) — The cycle works, but production must pre-ignore result artifacts, negotiate installed Herdr capabilities, and structurally reject Jujutsu conflicts and stale approvals.
- [Define agent prompt and configuration contracts](define-agent-contracts.md) — Use coordinator-owned layered prompts and independently versioned role envelopes/artifacts; trusted projects may add contained Markdown specialization and request bounded model/tool changes.
- [Define orchestration observability and Pi UI](define-observability-ui.md) — Show compact semantic progress in a widget and detailed control in `/subagents`; queue attention without stealing focus, link explicitly to Herdr, and require interactive TUI/RPC modes.
- [Define trust and command permission policy](define-trust-permissions.md) — Require project trust, launch child Pi with guarded role tools and minimal environments, deny secrets/network/hooks/upstream credentials, and scope command approvals to one exact attempt fingerprint.
- [Define packaging and distribution](define-packaging-distribution.md) — Publish `@aivv/pi-subagents` as an exact-versioned npm Pi package under MIT OR Apache-2.0, ship source plus compiled ESM, require external tools, and gate releases with capability-tested doctor checks.
- [Specify the implementation route](specify-implementation-route.md) — Nine governing Linked Specs and a twenty-task dependency-ordered backlog define the validated implementation route.

## Frontier

None. The route to the destination is fully mapped.

## Planned questions

None.

## Not yet specified

None. Prototype findings graduated the remaining in-scope fog into precise tickets.

These questions depend on framework capabilities and integration constraints discovered by the current tickets.

## Out of scope

- Compatibility with oh-my-pi configuration or APIs
- Multiple competing solutions for the same subtask
- User-authored task graphs
- General-purpose orchestration outside Pi
- Destination implementation during the mapping phase
