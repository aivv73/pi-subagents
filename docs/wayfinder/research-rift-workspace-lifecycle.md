# Research Rift workspace lifecycle

**Type:** research  
**Status:** closed  
**Blocked by:** none

## Question

How can Rift create, identify, update, integrate, and dispose isolated `jj` workspaces, and what conflict and failure behavior must the extension handle?

## Deliverable

[Rift workspace lifecycle](artifacts/rift-workspace-lifecycle.md)

## Resolution

Rift can own fast copy-on-write directory snapshots and cleanup, but it cannot directly own shared `jj` workspaces or integrate revisions. Validate a composition strategy before defining the integration protocol.

## Map

[Effect-based Pi subagent orchestration](README.md)

## Unlocks

- [Define task graph and execution semantics](define-task-graph-semantics.md)
- [Validate Rift and Jujutsu composition](prototype-rift-jj-composition.md)
