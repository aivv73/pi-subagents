# REQ-external-runtime-distribution: External runtime and distribution obligations

The extension must be distributed as `@aivv/pi-subagents`, licensed `MIT OR Apache-2.0`, while treating Pi, Herdr, Rift, Jujutsu, and Git as separately installed external prerequisites.

The shipped package is an ESM Pi package. It declares Pi packages as peer dependencies, Effect as a production dependency, and publishes its corresponding TypeScript source, declarations, source maps, prompt/schema asset directories, license texts, third-party notice, changelog, and security policy alongside compiled extension code.

## Authority

- Stakeholder distribution decision, confirmed by aivv on 2026-07-22.
- Herdr declares AGPL-3.0-or-later and offers separate commercial licensing.
- Pi package installation and dependency behavior are defined by Pi’s package interface.

## Requirements

- npm is the primary channel and signed Git tags are secondary.
- Documentation and project settings must recommend exact package versions and explicit upgrades.
- Published artifacts must include compiled ESM, corresponding TypeScript source, declarations, source maps, schemas, prompt assets, changelog, security policy, both extension licenses, and third-party notices.
- Pi-owned packages are peer dependencies. Effect and other non-Pi runtime libraries are production dependencies.
- Installation must not bundle, download, install, patch, or update Herdr, Rift, `jj`, Git, or Pi.
- Herdr integration must use a separately installed unmodified executable through documented CLI/socket protocols. Bundled, modified, plugin-based, hosted, or closed-source commercial variants require renewed legal/architectural review or appropriate commercial licensing.
- `/subagents doctor` and `pi-subagents doctor --json` must share read-only capability checks.
- Compatibility must use tested minimum versions plus runtime capabilities, including the installed Herdr protocol schema. Unsupported environments fail before Rift creation.
- Releases begin as SemVer prereleases under npm `next`. Promotion requires the support-matrix acceptance suite.
- Release CI must reject tarballs containing external binaries/source payloads, credentials, journals, or test secrets and must verify source/license correspondence and npm provenance where available.

The current preflight records exact observed Pi, Node, Herdr, Jujutsu, and Git version output and Herdr protocol/schema versions as capability evidence. Rift exposes no installed version command in the supported CLI, so preflight proves its required `create`, `--copy-all`, and `--no-hooks` capabilities from its local help. It accepts no guessed numeric range: required Herdr operations are discovered from the installed JSON schema.

This requirement constrains [ARCH-pi-subagents](ARCH-pi-subagents.md) and all public compatibility behavior.
