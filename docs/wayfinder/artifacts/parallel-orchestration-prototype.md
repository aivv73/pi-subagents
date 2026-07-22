# Parallel orchestration cycle prototype

## Result

The architecture can support the target cycle, but the disposable prototype exposed four protocol requirements that must be incorporated before production implementation:

1. result artifacts must be ignored before workers start;
2. Herdr API/version capability detection must use the installed schema, not repository `next` documentation;
3. integration must query Jujutsu conflict state rather than inspect file text;
4. approved parallel changes must be rebased/merged against the latest integration base and re-reviewed when that changes their effective diff.

The final fixture completed with `alpha=1` and `beta=1` after two parallel workers, a reviewer rejection, one bounded worker revision, an integration conflict, one conflict-resolution cycle, fresh review, and deterministic integration.

## Environment

- Node `26.4.0`
- Bun `1.3.14`
- Effect `3.22.0`
- Pi `0.81.1`
- Herdr `0.7.4`, protocol `16`
- Jujutsu `0.43.0`
- Rift CLI on btrfs
- Disposable fixture under `/home/aivv/.cache/pi-subagents-parallel-prototype`

The fixture and all Herdr/Rift resources were removed after evidence capture.

## Concrete cycle

### Decomposition and isolation

A small Effect program represented an automatically accepted two-node independent DAG:

```text
alpha: alpha=0 -> alpha=1
beta:  beta=0  -> beta=1
```

The decomposition itself was deterministic fixture data, not LLM-generated; the prototype validates orchestration mechanics rather than decomposition quality.

Rift created exact copy-on-write worker snapshots. Each snapshot immediately ran `jj new main`, yielding distinct task change IDs. Herdr created separate workspaces and launched named interactive Pi agents in those snapshot directories.

Both workers ran concurrently. The initial outputs were:

```text
alpha=WRONG, beta=0
alpha=0,     beta=1
```

Each produced a versioned JSON result containing task, change, commit, summary, and check identities.

### Structured result repair

The first worker artifacts were written as `result.json` inside the repositories without a prior ignore rule. Jujutsu snapshotted those files, changing each commit ID after the artifact had recorded it. Coordinator validation caught the mismatch.

The same workers received one repair-only prompt. They added `/result.json` to `.git/info/exclude`, untracked it, and atomically rewrote the artifact with current IDs without repeating task mutations. Validation then confirmed `result.json` was absent from `jj file list` and artifact IDs matched the published commits.

This proves the result repair path works, but production bootstrap must create an ignored coordinator-owned artifact directory before launching workers so repair is exceptional.

### Publication and first review

Workers published unique bookmarks to a coordinator-owned local bare Git repository. The coordinator fetched and matched exact result IDs.

A separate reviewer Rift snapshot and Pi agent inspected both diffs. Its structured decision was:

```json
{
  "alpha": {
    "decision": "revision_requested",
    "finding": "state.txt sets alpha=WRONG; change it to alpha=1 and leave beta=0 unchanged"
  },
  "beta": { "decision": "approved" }
}
```

The original alpha worker amended the same change and artifact. A fresh reviewer snapshot approved the new exact commit.

### Integration conflict and resolution

Deterministic integration attempted alpha then beta. Even though the tasks changed different logical lines, both edited the same small file from the same base. Creating a Jujutsu merge working copy produced a two-sided conflict.

The first Effect prototype had an invalid success assertion: it searched for `alpha=1` and `beta=1` in file text, and both strings existed inside conflict markers. It journaled a false `RunSucceeded`. This was deliberately treated as a failed prototype invariant, not accepted behavior.

The corrected rule is:

- query Jujutsu for conflicted revisions/paths first;
- require an exact expected working-tree state only after Jujutsu reports no conflicts;
- never infer success from substring checks or process exit alone.

The beta worker then rebased its existing change onto the integrated alpha commit, resolved the file to:

```text
alpha=1
beta=1
```

It retained its task change ID, published a new commit ID, and received fresh approval in a third reviewer snapshot. Final deterministic integration completed without conflicts.

Final history included:

```text
integrate beta resolved
beta change
integrate alpha
```

### Effect mechanics exercised

The disposable TypeScript coordinator used:

- Effect Schema decoding for worker and reviewer artifacts;
- `Effect.forEach(..., { concurrency: 2 })` for parallel validation;
- append-only versioned JSONL events;
- exact artifact/ref approval binding;
- deterministic alpha-then-beta integration;
- command execution through argv/cwd boundaries.

The prototype did not implement the complete production reducer, snapshots, semaphores, restart recovery, or Pi extension UI. Those remain implementation-route work, not evidence required for this thin slice.

## Herdr findings

- Herdr visibly hosted each worker/reviewer in separate persistent panes, satisfying the intended human observability model.
- Installed Herdr `0.7.4` differed from the cloned `next` docs: it offered `agent send` instead of `agent prompt`, and `agent start` created a new pane rather than accepting `--pane`.
- Sending prompt text and Enter immediately after startup raced with Pi readiness once; the text remained in the editor until another Enter.
- Pi lifecycle status was sometimes `unknown` or `idle` despite prompt/editor state. Artifact and repository validation correctly remained authoritative.

Production must negotiate capabilities from `herdr api schema --json`, pin a minimum protocol, and model startup readiness explicitly.

## User-facing interaction observed

A useful Pi extension view can remain compact because Herdr already exposes terminal detail. The extension needs to show only:

- graph counts by semantic state;
- worker/reviewer names linked to Herdr workspace/pane IDs;
- current task and attempt;
- blocked/revision/conflict findings;
- exact integrated or retained resource IDs;
- cleanup/recovery actions.

The main interaction hazard is presenting Herdr `done`/`idle` as semantic success. UI wording must distinguish **agent settled** from **result validated**, **review approved**, and **integrated**.

## Required changes before implementation

1. Create `.pi-subagents/` as an ignored, contained artifact area during bootstrap and verify it remains untracked.
2. Generate or decode Herdr DTOs from the installed protocol schema and gate unsupported versions.
3. Add a startup-ready handshake before prompt submission.
4. Use structured `jj` templates/revsets for conflict and revision checks.
5. Before integrating each approved task, compute its effective diff against the latest deterministic integration base; rebase/merge and re-review if changed.
6. Make journal terminal-state invariants reject any unresolved conflict, stale approval, missing cleanup ownership, or unmatched commit ID.
7. Preserve the repair-only result prompt as a bounded fallback, not normal workflow.

