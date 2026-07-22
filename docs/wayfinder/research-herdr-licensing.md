# Determine Herdr licensing and distribution constraints

**Type:** research  
**Status:** closed  
**Blocked by:** none

## Question

What AGPL-3.0-or-later or commercial-license obligations apply to invoking, requiring, bundling, modifying, or distributing Herdr with this Pi extension?

## Notes

Collect authoritative license text and packaging facts. Flag questions requiring qualified legal advice rather than supplying it.

## Deliverable

[Herdr licensing and distribution constraints](artifacts/herdr-licensing.md)

## Resolution

Proceed only with a separately installed, unmodified Herdr executable accessed through its documented CLI/socket protocol. Do not bundle, patch, link, auto-download, or redistribute Herdr. Commercial, hosted, plugin, or closed-source scenarios require renewed qualified legal review or a commercial Herdr license.

## Map

[Effect-based Pi subagent orchestration](README.md)

## Unlocks

- [Choose Effect architecture and module boundaries](choose-effect-architecture.md)
- [Specify the implementation route](specify-implementation-route.md)
