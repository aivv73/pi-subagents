# Research Herdr coordination primitives

**Type:** research  
**Status:** closed  
**Blocked by:** none

## Question

Which Herdr primitives can define roles, dispatch parallel subagents, collect structured results, implement bounded retries, and assign a reviewer subagent?

## Deliverable

[Herdr coordination primitives](artifacts/herdr-coordination-primitives.md)

## Resolution

Use Herdr only as a subprocess host and operational observability surface. Keep semantic orchestration in Effect, require structured results outside terminal scraping, and decide whether Herdr-hosted Pi processes replace or coexist with SDK workers.

## Map

[Effect-based Pi subagent orchestration](README.md)

## Unlocks

- [Choose worker hosting and Herdr boundary](choose-worker-hosting.md)
- [Determine Herdr licensing and distribution constraints](research-herdr-licensing.md)
