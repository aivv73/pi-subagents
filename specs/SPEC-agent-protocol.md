# SPEC-agent-protocol: Agent roles, configuration, and artifacts

The current coordinator owns built-in worker and reviewer contracts. Decomposer, result-repair, and conflict-resolver roles are not implemented.

## Configuration and prompts

Worker and reviewer instructions are built-in package assets. The child launch policy disables built-in tools, discovered extensions, skills, prompt templates, context files, themes, sessions, and project approval; it explicitly loads only the coordinator-owned child extension. The worker command selects the parent model and appends the built-in worker prompt. Global/project role configuration, specialization, and overrides are not implemented.

Project/repository/task text remains untrusted data and cannot override isolation, identity, artifact, or permission rules.

## Artifact area

Before launch the coordinator creates and verifies an ignored contained area:

```text
.pi-subagents/runs/<run>/tasks/<task>/attempts/<attempt>/
  input/<role>-envelope.vN.json
  output/<role>-result.vN.json
  evidence/
```

The coordinator creates the artifact directories only after proving `/.pi-subagents/` is ignored in the local Git exclude policy. Input envelopes are version-one coordinator-written JSON plus a SHA-256 sidecar, mode `0400`, and validated before output use. Worker and reviewer result outputs are version-one, size-limited, strict-schema JSON, identity-bound to the envelope, written through a same-directory atomic rename, and rejected when regular-file, containment, symlink, or checksum checks fail. A Jujutsu commit-ID invariant proves artifact writes do not change the current task change.

The public direct-task command requires one or more `--paths` values before task text. Repeated comma-separated values are normalized and deduplicated. Before any resource exists, every path must be a repository-relative existing regular file or a new target whose existing parent is contained and non-symlink; protected metadata/credential/environment segments, absolute/traversal paths, symlinks, and root escapes fail closed. Current envelopes carry run/task/attempt/role IDs, the full user command as task/acceptance guidance, canonical root, declared tracked write paths, assigned base commit, and the fixed version-one output path. The worker/reviewer supervisors separately retain Herdr pane and Rift identities. Reviewer child guard configuration additionally fixes one reviewed commit and base solely for its read-only diff; it is not a generic revision selector. Model facts, checks, deadlines, and prompt hashes are not persisted yet.

## Outputs

- Worker: exact run/task/attempt identity, one change/commit identity, and changed paths. A reviewer-requested amendment reuses the same worker attempt/Rift/pane/change ID, replaces this artifact atomically with a changed commit identity, and receives the reviewer findings as coordinator-provided text.
- Reviewer: exact run/task/attempt and commit/base identity, approval or revision request, and findings. The coordinator accepts it only after ref/base/target revalidation and proof that reviewer tracked state did not change.

After writing output, the agent may print `PI_SUBAGENT_RESULT <relative-path>`. This marker and Herdr settlement are diagnostic only.

Missing or invalid output fails this slice directly; it neither consumes the one reviewer-revision budget nor starts execution retry. Result repair is unsupported. Worker/reviewer envelope/output contracts are version one. Migration and recovery decoding are unsupported.

Revision authority follows [SPEC-change-integration](SPEC-change-integration.md).
