# Rift and Jujutsu composition prototype

## Decision

Use **independent exact Rift snapshots with an explicit Git transport boundary**. Each worker gets an independent colocated Jujutsu repository copied by Rift, creates a fresh task change, and publishes only an explicitly named reviewed bookmark to a coordinator-owned local bare Git repository. The coordinator fetches that bookmark into its own Jujutsu repository and integrates it with normal `jj` operations.

Do not describe Rift snapshots as native `jj` workspaces. Do not copy `.jj` metadata into or out of a native workspace. A native `jj workspace add` plus optional cache materialization remains a fallback when shared operation history matters more than Rift ownership.

## Prototype environment

- Rift `0.0.10`, built from repository `main`
- Jujutsu `0.43.0`
- Git-backed colocated Jujutsu repositories
- btrfs under `/home`
- Disposable custom Rift SQLite database and local bare Git remote

All fixtures were created under `/home/aivv/.cache/wayfinder-rift-jj-prototype` and removed after the experiment.

## Experiment A: exact Rift snapshot with Git transport

1. Created a local bare Git remote.
2. Created a colocated `jj` clone, committed a base, and pushed `main`.
3. Registered the source with Rift.
4. Ran `rift create --copy-all --no-hooks --name worker-a`.
5. Changed and committed a file in the snapshot, created bookmark `worker-a`, and checked visibility from the source.
6. Pushed only `worker-a` to the local bare remote and fetched it from the source.
7. Removed the Rift and ran garbage collection.

Observed:

```text
source_repo_kind=directory
worker_repo_kind=directory
source_sees_worker_before_push=0
source_remote_commit=<commit-id> <change-id> worker-a
source_file_unchanged=yes
rift_children_before_remove=1
worker_exists_after_remove=no
gc_removed=1
```

The snapshot’s `.jj/repo` was a directory, proving it was an independent repository store rather than a shared Jujutsu workspace pointer. Worker operations were invisible to the source before explicit Git publication. After push/fetch, the source addressed the worker commit and retained its Jujutsu change ID and description.

Creating a merge working copy from a concurrently modified coordinator commit and the fetched worker commit produced a normal explicit Jujutsu conflict:

```text
Working copy (@) ... (conflict) ... integrate
Warning: There are unresolved conflicts at these paths:
app.txt    2-sided conflict
```

This is acceptable: transport does not silently overwrite the coordinator tree, and integration conflicts remain Jujutsu objects for reviewer/escalation handling.

### Critical change-ID hazard

An exact snapshot duplicates the source working-copy change ID. If source and worker independently commit different content on that copied working-copy change, fetching the worker produces divergent commits with the same change ID.

Therefore the worker bootstrap protocol must, before edits:

1. verify the expected immutable base commit;
2. create a fresh task working-copy change from that base;
3. record the fresh change ID and initial commit ID;
4. ensure publication contains only that task change and intended descendants.

The coordinator must reject a result whose declared task change ID equals the copied source working-copy change ID or whose ancestry escapes the assigned base.

## Experiment B: native shared Jujutsu workspace

`jj workspace add` created a workspace with:

```text
native_repo_kind=pointer
native_repo_pointer=../../source/.jj/repo
source_lists_native_workspace=1
```

After `jj workspace forget`, the source no longer listed it. This is the correct supported shared-repository lifecycle.

An ignored cache file was absent initially and could be reflink-copied into the native workspace without affecting tracked state. A temporary Rift snapshot could supply such ignored artifacts, but Rift would only be a cache/materialization helper—not the workspace owner. There is no supported operation to turn a populated Rift destination into a native `jj workspace add` destination, and transplanting `.jj` metadata was deliberately not attempted.

## Rejected composition

Do not replace a copied Rift `.jj` directory with a `.jj/repo` pointer generated elsewhere. Relative repository pointers, workspace IDs, checkout state, colocated `.git` state, and operation-store assumptions make this unsupported metadata surgery. Neither Rift nor Jujutsu documents it as safe.

## Required protocol

### Creation

1. Require a clean coordinator lifecycle point and capture the assigned base commit ID.
2. Ensure the source is Rift-managed and on a supported filesystem.
3. Create with deterministic unique name, `copyAll: true`, and hooks disabled.
4. Validate Rift ancestry and destination ownership.
5. In the worker snapshot, import Git state if needed and create a fresh task change from the exact assigned base.
6. Launch the worker only after recording Rift path, base commit, task change ID, and transport bookmark.

### Publication and review

1. Worker leaves a non-empty described task change and reports its exact IDs.
2. Push a unique temporary bookmark to a coordinator-owned local bare remote.
3. Coordinator fetches and validates ancestry, changed paths, task identity, and absence of unrelated bookmarks.
4. Reviewer inspects the fetched immutable commit(s), not mutable worker terminal output.
5. On rejection, the original worker revises its task change and force-with-lease semantics update the same temporary bookmark; the coordinator fetches and re-reviews.
6. On approval, integrate through `jj new`/merge or a deliberate duplicate-and-rebase policy. Preserve conflicts for escalation; never resolve automatically by choosing one side.

### Cleanup

1. Delete/forget the temporary transport bookmark after terminal disposition.
2. `rift remove` the worker subtree.
3. Run `rift gc` asynchronously according to retention policy.
4. Reconcile Rift registry and transport refs after interrupted cleanup.

## Limits

- The prototype used one worker; concurrency safety of bookmark naming and coordinator fetch serialization remains an architecture concern.
- Rift’s SQLite registry handles concurrent registry access, but Git remote updates and coordinator `jj git fetch` still require coordinator-level serialization.
- Exact snapshots include potentially large ignored artifacts and secrets. Trust and redaction policy remains unresolved.
- Jujutsu/Git behavior was validated only on the stated versions; pin or compatibility-test supported versions.
- The local bare Git remote is a transport mechanism, not the project’s upstream remote. Worker credentials must not permit publication to arbitrary remotes.

## Evidence sources

- [Rift workspace lifecycle](rift-workspace-lifecycle.md)
- `rift init`, `create --copy-all --no-hooks`, `list`, `remove`, and `gc` against disposable btrfs fixtures
- `jj workspace add`, `workspace list`, `workspace forget`, `git push`, `git fetch`, `log`, and merge-working-copy creation against disposable repositories

