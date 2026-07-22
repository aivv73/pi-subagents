# Research Pi extension orchestration boundaries

**Type:** research  
**Status:** closed  
**Blocked by:** none

## Question

Which supported Pi extension APIs and lifecycle boundaries can the coordinator use for commands, agent execution, UI feedback, cancellation, configuration, and shutdown?

## Deliverable

[Pi extension orchestration boundaries](artifacts/pi-extension-orchestration.md)

## Resolution

Use a thin Pi extension as the parent interface and independent Pi SDK `AgentSession`s behind an adapter as the initial worker runtime. Keep workers on explicit cwd/tool/resource boundaries, and bind cancellation and cleanup to Effect scopes and Pi shutdown.

## Map

[Effect-based Pi subagent orchestration](README.md)

## Unlocks

- [Define task graph and execution semantics](define-task-graph-semantics.md)
- [Choose Effect architecture and module boundaries](choose-effect-architecture.md)
