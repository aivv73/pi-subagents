# Validate Rift and Jujutsu composition

**Type:** prototype  
**Status:** closed  
**Blocked by:** none

## Question

Which, if any, concrete composition safely provides Rift-backed filesystem isolation while preserving identifiable and integrable Jujutsu changes: independent snapshots with Git transport, shared `jj` workspaces with Rift-assisted materialization, or neither?

## Notes

Build only disposable fixtures. Exercise colocated and non-colocated repositories, concurrent workers, dirty source state, revision transfer, conflicts, and cleanup. Do not modify Rift or Jujutsu production repositories.

## Evidence

[Rift workspace lifecycle](artifacts/rift-workspace-lifecycle.md)

## Artifact

[Rift and Jujutsu composition prototype](artifacts/rift-jj-composition.md)

## Resolution

Use exact independent Rift snapshots with a coordinator-owned local bare Git transport. Bootstrap a fresh worker change ID from the assigned base, publish only a unique temporary bookmark, validate and review fetched commits, then integrate with normal Jujutsu conflict semantics.

## Map

[Effect-based Pi subagent orchestration](README.md)

## Unlocks

- [Define isolated change and integration protocol](define-integration-protocol.md)
- [Choose Effect architecture and module boundaries](choose-effect-architecture.md)
