# SPEC-agent-protocol: Agent roles, configuration, and artifacts

The coordinator owns decomposer, worker, reviewer, result-repair, and conflict-resolver role contracts.

## Configuration and prompts

Global configuration is `~/.pi/agent/subagents.json`. Trusted project configuration is `.pi/subagents.json`; role specialization is contained Markdown under `.pi/subagents/prompts/`. Files are non-executable and decoded with versioned Effect Schema.

Prompts compose coordinator invariants, built-in role instructions, trusted project specialization, and a concise task-envelope reference in descending authority. Project/repository/task text remains untrusted data and cannot override isolation, identity, artifact, or permission rules.

Role model patterns resolve through Pi. An absent pattern falls back to the parent model; an explicitly unavailable pattern fails launch. Tool requests may narrow defaults; expansions require [SPEC-trust-permissions](SPEC-trust-permissions.md).

## Artifact area

Before launch the coordinator creates and verifies an ignored contained area:

```text
.pi-subagents/runs/<run>/tasks/<task>/attempts/<attempt>/
  input/<role>-envelope.vN.json
  output/<role>-result.vN.json
  evidence/
```

Input envelopes are coordinator-written, read-only, checksummed, and journal-bound. Outputs are size-limited, contained, non-symlink, and atomically renamed. The coordinator validates schema, identity, checksum, ownership, and repository facts.

Common envelope data includes contract/run/task/attempt/role IDs, model/tool facts, owned paths, Herdr/Rift identities, assigned/integration bases, allowed/forbidden revisions/paths, acceptance criteria, checks, budgets, deadlines, output path, and prompt hashes.

## Outputs

- Decomposer: candidate graph and risk/cost hints.
- Worker: ordered revision stack, changed paths, checks, evidence, diagnostics, and proposed tasks.
- Reviewer: exact commit/base binding, checks, findings, and approval or revision request.
- Repair: repaired artifact plus proof task revisions did not change.
- Conflict resolver: old/new base, preserved task IDs, resolved revisions/paths, remaining conflicts, and checks.

After writing output, the agent may print `PI_SUBAGENT_RESULT <relative-path>`. This marker and Herdr settlement are diagnostic only.

Missing/invalid output receives one repair-only prompt. A second failure fails the attempt.

Each role envelope/output pair versions independently. The coordinator writes current versions and supports pure migrations from the previous two released versions for recovery. Unsupported versions pause recovery.

Revision authority follows [SPEC-change-integration](SPEC-change-integration.md).

