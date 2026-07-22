# Define packaging and distribution

**Type:** grilling  
**Status:** closed  
**Blocked by:** [Determine Herdr licensing and distribution constraints](research-herdr-licensing.md), [Prototype one parallel orchestration cycle](prototype-parallel-cycle.md)

## Question

How should the Pi extension be packaged, versioned, installed, licensed, and compatibility-gated while requiring separately installed Herdr, Rift, `jj`, and Pi executables?

## Resolution

### Package identity and channels

Primary package:

```text
@aivv/pi-subagents
```

Publish it as a public npm Pi package with `pi-package` keyword and an explicit `pi.extensions` manifest. Signed/pinned Git tags are the secondary inspectable install source.

Recommended installs always pin an exact release:

```bash
pi install npm:@aivv/pi-subagents@0.x.y
# secondary
pi install git:github.com/<publisher>/pi-subagents@v0.x.y
```

Project settings should also use exact versions. The extension never self-updates. Users upgrade explicitly, and journal/config/contract migrations validate before the new runtime resumes unfinished work.

### Extension license

License the extension’s original code under:

```text
MIT OR Apache-2.0
```

Ship both `LICENSE-MIT` and `LICENSE-APACHE` plus SPDX identifiers in package metadata and source headers where useful. Third-party notices remain governed by their own licenses.

Herdr is not included and remains separately licensed under AGPL-3.0-or-later or its commercial terms. Documentation must clearly separate the extension license from Herdr’s license and link to [Herdr licensing and distribution constraints](artifacts/herdr-licensing.md).

### Pi package manifest

Representative metadata:

```json
{
  "name": "@aivv/pi-subagents",
  "version": "0.1.0-next.1",
  "type": "module",
  "license": "MIT OR Apache-2.0",
  "keywords": ["pi-package", "pi", "subagents", "effect", "jj", "herdr", "rift"],
  "pi": {
    "extensions": ["./dist/extension/index.js"]
  },
  "bin": {
    "pi-subagents": "./dist/cli.js"
  },
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  },
  "dependencies": {
    "effect": "<pinned compatible range>"
  }
}
```

Pi-provided packages remain unbundled peers. Effect and any non-Pi runtime library belong in production `dependencies` because Pi package installs omit development dependencies.

### Release contents

Publish both inspectable source and compiled output:

```text
dist/extension/          compiled parent extension
dist/child-extension/    compiled guarded child runtime
dist/cli.js              doctor CLI
dist/**/*.d.ts
dist/**/*.js.map
src/                     corresponding TypeScript source
schemas/                 public config/envelope/artifact/event schemas
prompts/                 built-in role prompt assets
README.md
CHANGELOG.md
SECURITY.md
LICENSE-MIT
LICENSE-APACHE
THIRD_PARTY_NOTICES.md
package.json
```

Pi loads compiled ESM, not raw TypeScript. Build outputs are reproducible from the shipped source and source maps. npm `files` is an allowlist; tests, fixtures with secrets, local journals, Rift state, Herdr binaries/plugins/integrations, and external executable artifacts are excluded.

Do not collapse the package into one opaque bundle. Preserve module boundaries and notices while allowing selective bundling only when required for runtime compatibility.

### External prerequisites

The npm package never bundles, downloads, installs, patches, or updates:

- Pi;
- Herdr;
- Rift;
- Jujutsu;
- Git.

Users install these through official channels. Documentation includes platform-specific links and explains Rift filesystem/platform requirements. npm install scripts must not fetch binaries or execute project setup.

### Compatibility model

Declare tested minimum versions and perform runtime capability checks. Version strings alone are insufficient.

Preflight verifies:

- Pi extension APIs and run mode required by the package;
- Herdr version, protocol number, installed schema, required methods/events, Pi agent detection/integration readiness;
- Rift required commands/options, platform, filesystem copy-on-write support, and custom database behavior;
- Jujutsu version plus required templates/revsets/workspace/Git/conflict behavior;
- Git version and local bare transport/ref-lease capabilities;
- Node runtime and Effect-supported features;
- project trust, writable state paths, and no unfinished incompatible journal migration.

The implementation spec will pin initial numeric minima from CI evidence. Unsupported or ambiguous capability checks fail before Rift creation and show exact detected/required facts.

Compatibility is represented as tested tuples, not independent optimistic ranges, because Herdr/Pi/Jujutsu behaviors can interact.

### Doctor interfaces

Expose the same Effect-based diagnostics through:

```text
/subagents doctor
pi-subagents doctor [--json]
```

The Pi command renders actionable TUI/RPC diagnostics. The standalone CLI supports setup and CI without starting a run. Both use the same schemas/check implementations and return nonzero/structured failure for missing or incompatible prerequisites.

Doctor is read-only. It does not initialize Rift, modify repositories, install integrations, alter config, or download tools. Suggested remediation links to official commands/documentation.

### Release and version policy

Use SemVer for package APIs, serialized contracts, configuration, and user-visible commands.

- Publish initial releases as `0.x.y-next.n` under npm dist-tag `next`.
- Promote to normal `0.x.y`/`latest` only after the complete spec acceptance suite passes on the support matrix.
- Publish `1.0.0` only when journal recovery, migrations, permission policy, packaging guarantees, and public contracts are declared stable.
- Breaking schema/prompt/config changes require SemVer signaling and migrations where promised.
- External compatibility-only changes are documented in the compatibility matrix and may require a package minor release.

Every release has a signed Git tag, changelog entry, npm provenance when available, checksum/SBOM artifacts, and a link from package version to exact source commit.

### Release gates

CI must verify:

1. typecheck, formatting, lint, unit and property tests;
2. event reducer determinism and migration fixtures;
3. package tarball install into a clean Pi environment;
4. `pi list` discovers exactly the intended extension;
5. standalone and Pi doctor parity;
6. child guarded-tool enforcement and no project extension discovery;
7. disposable Herdr/Rift/`jj` end-to-end acceptance cycle;
8. minimum and latest-supported compatibility tuples;
9. Linux btrfs/reflink and supported macOS Rift paths where CI permits;
10. tarball allowlist, license files, notices, source maps, schemas, and source correspondence;
11. explicit failure if any Herdr/Rift/`jj`/Git binary, Herdr source/plugin/integration payload, credential, journal, or test secret enters the tarball;
12. `npm pack --dry-run` review and package size budget.

### Upgrade activation

On extension load after an upgrade:

1. inspect journals/config without starting background agents;
2. validate package and external compatibility;
3. preview required migrations and create backups/checkpoints;
4. apply idempotent migrations only after required confirmation;
5. leave incompatible unfinished runs paused with remediation options;
6. never downgrade or rewrite newer unsupported contracts.

Exact-version pins make rollback possible, but rollback is allowed only when journal/config versions remain supported by the older release.

### Distribution boundary

Commercial, closed-source, hosted, Herdr-bundled, Herdr-modified, or plugin-based variants are not covered by this packaging decision. They require renewed architecture/license review and potentially a commercial Herdr license.

## Map

[Effect-based Pi subagent orchestration](README.md)

## Unlocks

- [Specify the implementation route](specify-implementation-route.md)
