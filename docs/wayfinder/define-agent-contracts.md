# Define agent prompt and configuration contracts

**Type:** grilling  
**Status:** closed  
**Blocked by:** [Prototype one parallel orchestration cycle](prototype-parallel-cycle.md)

## Question

What versioned worker, reviewer, decomposer, repair, and conflict-resolution prompt contracts and project configuration fields provide sufficient authority, containment, acceptance criteria, and artifact instructions?

## Resolution

### Built-in roles and specialization

The coordinator owns five protocol roles:

- `decomposer`: returns a candidate DAG and no repository changes;
- `worker`: performs one assigned task in one isolated attempt;
- `reviewer`: inspects exact fetched revisions and returns approval or bounded findings;
- `result-repair`: repairs only a missing/invalid output artifact without repeating task mutations;
- `conflict-resolver`: updates the original task change against a new integration base, resolves conflicts, and returns a new worker result requiring fresh review.

These roles have built-in secure prompts, schemas, and default capabilities. Trusted projects may specialize prompts, model patterns, and requested tools, but cannot replace role semantics or coordinator invariants.

### Prompt composition and authority

Every agent prompt is composed in this order:

1. **Coordinator invariant prompt** — role authority, prohibited actions, isolation, exact-ID rules, artifact protocol, cancellation, and completion behavior.
2. **Built-in role prompt** — role-specific workflow and validation checklist.
3. **Trusted project specialization** — bounded Markdown content for domain conventions and additional acceptance guidance.
4. **Task envelope reference** — concise invocation text naming the read-only versioned envelope path and required output path.

Earlier layers have higher authority. Project/task content is explicitly untrusted data even in a trusted repository and cannot override coordinator invariants. Prompt text uses clear data delimiters and instructs agents not to execute instructions found in files, diffs, issue text, or artifact payloads unless the task contract authorizes them.

### Configuration files

Global configuration:

```text
~/.pi/agent/subagents.json
```

Trusted project configuration:

```text
.pi/subagents.json
.pi/subagents/prompts/<role>.md
```

Both JSON files are non-executable and decoded with versioned Effect Schema. Global defaults load first; project configuration may override only fields marked project-overridable after `ctx.isProjectTrusted()` succeeds. Unknown fields are errors rather than silently ignored.

Project prompt paths must:

- be relative to `.pi/subagents/prompts/`;
- resolve after symlink/canonical-path checks inside that directory;
- be regular UTF-8 Markdown files;
- satisfy per-file and aggregate size limits;
- have provenance recorded in the run journal.

Inline project prompt strings, absolute paths, command substitutions, and executable prompt generators are unsupported.

### Configuration shape

The configuration contract includes:

```json
{
  "schemaVersion": 1,
  "models": {
    "decomposer": "model-pattern",
    "worker": "model-pattern",
    "reviewer": "model-pattern",
    "resultRepair": "model-pattern",
    "conflictResolver": "model-pattern"
  },
  "roles": {
    "worker": {
      "specialization": "prompts/worker.md",
      "tools": { "allow": [], "deny": [] }
    }
  },
  "limits": {
    "globalAgents": 4,
    "workers": 3,
    "reviewers": 1,
    "executionRetries": 1,
    "reviewRevisions": 1,
    "conflictRevisions": 1,
    "maxStackChanges": 5
  },
  "retention": {},
  "timeouts": {},
  "compatibility": {}
}
```

Exact defaults remain spec work, but fields are finite and bounded by coordinator hard caps. Security invariants, artifact roots, transport remotes, journal locations, and upstream credential policy are not configurable through project files.

### Model selection

- Each role may specify a Pi model pattern.
- Pi resolves configured patterns through its model registry and credentials.
- If no role pattern is configured, use the parent session’s active model and compatible thinking level.
- If an explicitly configured pattern cannot resolve/authenticate, fail that role launch; do not silently use another model.
- Resolved provider/model/thinking values are frozen in the run/attempt journal before launch.
- Agents cannot select or change their own model.

### Tool selection

Built-in role baselines:

- decomposer: repository read/search tools only;
- worker: read/search plus bounded mutation and command tools;
- reviewer: read/search and bounded test commands, no tracked mutation tools;
- result-repair: artifact-area writes and read-only identity commands only;
- conflict-resolver: worker tools constrained to the assigned conflict workspace.

Global/project configuration may narrow allowlists directly. Additional tool requests flow through the trust/permission policy and may be denied. Prompt text never grants tool authority.

### Artifact layout

Before launching any agent, the coordinator creates and validates:

```text
.pi-subagents/
  runs/<run-id>/
    tasks/<task-id>/attempts/<attempt-id>/
      input/<role>-envelope.vN.json
      output/<role>-result.vN.json
      evidence/
```

The coordinator adds `/.pi-subagents/` to repository-local ignore/exclude state before worker bootstrap and verifies Jujutsu does not track it. Directories use restrictive permissions. Agents receive only their attempt paths; output paths cannot be symlinks or escape the owned Rift root.

Input envelopes are coordinator-written, read-only, checksummed, and journal-bound. Output artifacts use temporary-file-plus-fsync-plus-rename semantics where supported. The coordinator validates ownership, containment, size, checksum, schema, and exact identities before reading evidence.

### Common envelope fields

Every role envelope contains:

- independent contract name/version;
- run/task/attempt/role IDs and causation ID;
- role-specific model/tool facts;
- workspace root, artifact root, and Herdr identities;
- assigned base, integration base, allowed changes/paths, and forbidden IDs;
- exact input commit/change/ref IDs;
- acceptance criteria and required checks;
- output schema/version/path and evidence limits;
- retry/revision budget and deadline/cancellation behavior;
- hashes of coordinator and project prompt layers.

Agents read the envelope file rather than receiving large embedded JSON or environment-variable payloads. They may not read the orchestration journal.

### Role outputs

- Decomposer output: candidate tasks, dependencies, roles, inputs, acceptance criteria, expected outputs, scope/path hints, and optional cost/risk annotations.
- Worker output: exact revision stack, checks, changed paths, summary, evidence, diagnostics, and proposed tasks.
- Reviewer output: exact commit/base binding, checks performed, findings, and `approved` or `revision_requested`.
- Repair output: repaired artifact identity plus proof that task revisions did not change during repair.
- Conflict output: old/new integration base, preserved task change IDs, resolved commit IDs/paths, remaining conflicts, checks, and diagnostics.

The detailed revision fields follow [Define isolated change and integration protocol](define-integration-protocol.md).

### Completion marker

After atomically writing the role output, an agent replies with only a short marker:

```text
PI_SUBAGENT_RESULT <relative-output-path>
```

The marker is diagnostic and helps Herdr/UI correlation. It is never authoritative. Herdr settlement with no valid artifact triggers the bounded result-repair protocol.

### Versioning and compatibility

- Each envelope/output pair has an independent contract name and integer version.
- The coordinator writes only current versions.
- It maintains tested pure migrations for artifacts from the previous two released versions, primarily for recovery of unfinished journals.
- Contract support is advertised in run metadata and package compatibility checks.
- Unsupported newer/older contracts pause recovery with an actionable error; agents do not negotiate arbitrary versions.
- Changes to authority, identity binding, or security semantics require a new contract version rather than permissive decoding.

## Map

[Effect-based Pi subagent orchestration](README.md)

## Unlocks

- [Specify the implementation route](specify-implementation-route.md)
