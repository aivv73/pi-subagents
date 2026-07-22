# Rift workspace lifecycle

## Answer

Rift is an experimental copy-on-write **directory snapshot manager**, not a Jujutsu workspace manager. It can create fast isolated filesystem copies and track their ancestry, but it has no `jj` integration, no revision exchange, and no merge operation. A copied `.jj` repository becomes a separate repository store; that is not equivalent to `jj workspace add`, whose workspaces share one repository and operation log.

The destination therefore needs an explicit and validated Rift–`jj` composition adapter. Treating `rift create` output as a native shared `jj` workspace is unsafe without such an adapter.

## Usable Rift interfaces

The published `rift-snapshot` package exposes synchronous JavaScript FFI functions:

```ts
init({ at, database? }): null
create({ from, name?, into?, copyAll?, hooks?, database? }): string
remove({ at, all?, database? }): void | string[]
list({ of, database? }): string[]
ancestors({ of, database? }): string[]
gc({ database? }): string[]
```

Failures throw `RiftError` with a stable code and sometimes a path. Node use currently requires Node 26.1+ with experimental FFI enabled; Bun has a separate FFI binding. The CLI exposes the same lifecycle and prints a created path to stdout, making it the more portable initial adapter for Pi’s present Node runtime.

Rift records a ULID in each workspace’s `.rift` marker and in a central SQLite registry. Parent IDs form a provenance tree. SQLite uses WAL mode, foreign keys, and a two-second busy timeout for concurrent processes.

## Create behavior

- The source must first be registered with `rift init` and reside on a supported copy-on-write filesystem.
- Linux supports btrfs snapshots or native reflinks; macOS supports APFS `clonefile`; Windows workspace creation is unimplemented. There is no full-byte-copy fallback.
- `create` copies the nearest managed ancestor, records the immediate Rift parent, and returns the destination path.
- Default filtered copies omit dependencies and build caches including `node_modules`, `target`, `dist`, and `build`. This undermines the main “warm snapshot” benefit for agent workspaces unless `copyAll: true` is selected.
- A caller-supplied `into` location must remain on a compatible filesystem. Destinations inside the source are rejected.
- `.rift.toml` postcreate hooks run sequentially after copying, Git preparation, and registry insertion. A failed hook leaves the workspace registered and on disk, so the coordinator must compensate explicitly.
- Creation errors before registration attempt to delete the destination. Postcreate failure is deliberately non-transactional.

## Git and Jujutsu interaction

Rift only recognizes a top-level `.git` entry:

- An independent `.git` directory is accepted, copied, and detached at the source commit while preserving index and working-tree state.
- A linked Git worktree (`.git` file) is rejected.
- Active Git merge, rebase, cherry-pick, revert, bisect, and lock states are rejected.
- Rift does not inspect `.jj`, exclude it, rewrite workspace metadata, invoke `jj`, or test Jujutsu repositories.

For a colocated Jujutsu repository, an exact Rift copy duplicates both `.git` and `.jj`, after which Rift directly rewrites the copied Git `HEAD`. The copied Jujutsu operation/store data is independent from the source and may import that detached Git state on its next command. For a non-colocated Jujutsu repository, Rift simply copies `.jj` as ordinary data. Neither case creates a shared Jujutsu workspace.

By contrast, `jj workspace add DESTINATION` creates a new working-copy commit while sharing the source repository store and operation log; the added workspace has a `.jj/repo` pointer rather than a copied repository store. `jj workspace forget` removes that workspace registration without deleting files.

## Removal and failure behavior

- Removing a created Rift moves its complete managed descendant subtree to adjacent `.trash` storage; physical deletion is deferred to `gc`.
- Descendants are processed deepest-first and every existing `.rift` marker must match the registry.
- A missing active descendant causes removal to fail rather than silently orphan registry state.
- Registry failure after filesystem moves triggers best-effort moves back to original paths.
- `gc` physically deletes trash and prunes missing active records only when no existing descendant would be orphaned.
- Removing the registered root preserves the source directory but removes its marker and trashes descendants; the CLI requires `--force`, while core/FFI does not.

## Required coordinator safeguards

1. Serialize lifecycle operations per source tree above Rift’s database-level locking; names and destination ownership still need application-level uniqueness.
2. Persist Rift path plus a coordinator task ID; the FFI API does not expose Rift ULIDs directly.
3. Use deterministic names and validate the returned path and `.rift` ancestry before launching an agent.
4. Disable arbitrary project postcreate hooks by default (`hooks: false`) or place them behind the project-trust policy. Hooks inherit environment and stdio and execute arbitrary commands.
5. On create/hook/agent failure, call `remove` and later `gc` according to retention policy; do not assume failed creation cleaned itself up.
6. Never remove the source root through FFI. Guard this in the adapter rather than relying on the CLI confirmation.
7. Detect unsupported filesystems/platforms before dispatch and provide a deliberate fallback or fail the orchestration before partial work begins.

## Integration options to validate

### A. Independent Rift snapshots with Git transport

Use Rift copies as independent colocated `jj` repositories, then exchange reviewed commits through the underlying Git repository or a dedicated local Git remote. This preserves Rift’s whole-tree snapshots but loses shared Jujutsu operation history and requires explicit bookmark/ref transport.

### B. Native shared `jj` workspaces plus Rift-assisted materialization

Use `jj workspace add` as the authority and investigate whether Rift can safely pre-materialize ignored/build artifacts around that workspace. Replacing copied `.jj` metadata with a shared-workspace pointer is not supported by either tool and must not be assumed safe without a prototype.

### C. Do not combine them

Use native Jujutsu workspaces for correctness and reserve Rift for non-VCS caches or drop Rift from worker workspace ownership. This conflicts with the current destination and would require an explicit scope decision.

No option is established by Rift today. A focused prototype is required before defining the integration protocol.

## Evidence

- Rift overview, platform matrix, lifecycle, FFI, and warning: `https://github.com/anomalyco/rift/blob/main/README.md`
- Normative repository behavior: `https://github.com/anomalyco/rift/blob/main/specs.md`
- Manager create/remove/list/ancestor/gc implementation: `https://github.com/anomalyco/rift/blob/main/crates/core/src/lib.rs`
- Git-only repository handling: `https://github.com/anomalyco/rift/blob/main/crates/core/src/git.rs`
- Filtered-copy exclusions: `https://github.com/anomalyco/rift/blob/main/crates/core/src/filter.rs`
- Concurrent registry behavior: `https://github.com/anomalyco/rift/blob/main/crates/core/src/registry.rs`
- Local Jujutsu 0.43 command documentation: `jj help workspace add`, `jj help workspace forget`, `jj help git import`, and `jj help git export`

