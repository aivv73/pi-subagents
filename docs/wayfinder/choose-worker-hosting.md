# Choose worker hosting and Herdr boundary

**Type:** grilling  
**Status:** closed  
**Blocked by:** none

## Question

Should workers run as Herdr-hosted interactive Pi subprocesses, in-process Pi SDK sessions with Herdr as an optional status surface, or behind dual runtime adapters, and which channel carries authoritative structured results?

## Resolution

Herdr-hosted interactive Pi subprocesses are the sole authoritative worker and reviewer runtime.

- The extension must fail before creating Rift workspaces if Herdr is unavailable; there is no automatic SDK fallback.
- Each process runs in a Herdr pane whose cwd is its assigned Rift snapshot.
- Herdr owns PTY/process lifetime and supplies operational state, attention, and human visibility.
- Herdr terminal state and rendered output are never authoritative task results.
- Each worker writes a versioned JSON result file inside its Rift workspace. The schema carries coordinator/task/attempt identity, assigned base, Rift path, `jj` change and commit IDs, status, summary, evidence, and diagnostics.
- The coordinator validates the result schema and cross-checks its identities and revisions against its own records and fetched repository state.
- If Herdr reports the agent settled but the result is absent or invalid, the coordinator prompts that same worker once to repair only the result file. It must not repeat task mutations. A second invalid result fails the attempt and escalates.
- Reviewer agents use the same hosting and result protocol, with a distinct schema payload for approval or rejection and bounded feedback.

This supersedes the initial SDK-worker recommendation in [Research Pi extension orchestration boundaries](research-pi-extension-orchestration.md). The Pi extension remains thin, but its runtime adapter targets Herdr rather than in-process `AgentSession`s.

## Evidence

- [Pi extension orchestration boundaries](artifacts/pi-extension-orchestration.md)
- [Herdr coordination primitives](artifacts/herdr-coordination-primitives.md)

## Map

[Effect-based Pi subagent orchestration](README.md)

## Unlocks

- [Define task graph and execution semantics](define-task-graph-semantics.md)
- [Define isolated change and integration protocol](define-integration-protocol.md)
- [Choose Effect architecture and module boundaries](choose-effect-architecture.md)
