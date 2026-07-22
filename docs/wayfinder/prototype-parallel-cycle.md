# Prototype one parallel orchestration cycle

**Type:** prototype  
**Status:** closed  
**Blocked by:** [Choose Effect architecture and module boundaries](choose-effect-architecture.md)

## Question

Does the chosen architecture support one disposable end-to-end cycle with automatic decomposition, two isolated parallel workers, reviewer feedback, one bounded retry, and approved integration?

## Notes

The artifact is a learning prototype, not production implementation. Record observed behavior, failed assumptions, and user-facing interaction for reaction.

## Artifact

[Parallel orchestration cycle prototype](artifacts/parallel-orchestration-prototype.md)

## Resolution

The architecture supports the cycle. The disposable run completed two concurrent Herdr-hosted Rift workers, structured result repair, reviewer rejection, bounded revision, conflict resolution, fresh approval, and final `jj` integration. Production contracts must pre-ignore result artifacts, negotiate installed Herdr protocol capabilities, and reject unresolved Jujutsu conflicts structurally.

## Map

[Effect-based Pi subagent orchestration](README.md)

## Unlocks

- [Specify the implementation route](specify-implementation-route.md)
