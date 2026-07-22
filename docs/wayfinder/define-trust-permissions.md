# Define trust and command permission policy

**Type:** grilling  
**Status:** closed  
**Blocked by:** [Prototype one parallel orchestration cycle](prototype-parallel-cycle.md)

## Question

Which project resources, hooks, environment variables, tools, Git credentials, command classes, paths, and approval prompts may each agent role access under trusted and untrusted project modes?

## Resolution

### Trust gate

Orchestration requires Pi project trust. In an untrusted project, the extension refuses before it:

- reads `.pi/subagents.json` or project role prompts;
- asks a decomposer to inspect repository content;
- initializes Rift or creates workspaces;
- starts Herdr panes or child Pi processes;
- creates journals, transport repositories, or artifacts in the project.

The refusal explains how to review and trust the project through Pi. The extension never substitutes repeated per-task prompts for project trust.

Trust is rechecked on session switch/resume and before recovery enters a different cwd. Revoked trust pauses active dispatch and requires cancellation/cleanup decisions; it does not silently continue from cached project configuration.

### Child Pi enforcement boundary

Workers and reviewers launch with built-in tools disabled. A coordinator-owned child extension supplies guarded, role-specific tools and protocol instructions.

The child extension:

- registers only the tools allowed for the role;
- canonicalizes and contains every path;
- mediates process execution through argv policies;
- strips/constructs environment variables;
- blocks network-capable commands by default;
- protects coordinator metadata and validates artifact destinations;
- reports denied operations as structured protocol diagnostics;
- cannot be overridden by project-local extensions or agent prompts.

Child Pi resource discovery excludes project extensions, prompt templates, and skills by default. Required project context is supplied through coordinator-reviewed envelope fields and contained read-only context files. Project role specialization is loaded by the coordinator, not rediscovered by the child.

This is a capability boundary, not a hardened OS sandbox. An explicitly approved executable may itself access resources beyond what the tool wrapper can mediate. The UI must disclose that risk. Strong hostile-code isolation is out of scope for the first version and would require containers/OS sandboxing as a later architectural change.

### Environment

Child processes receive a constructed minimal allowlist, not the parent environment. Baseline includes only values required for runtime operation, locale/terminal behavior, temporary directories, and coordinator-generated identifiers.

Coordinator-injected values include opaque run/task/attempt IDs, owned workspace/artifact paths, and Herdr variables required by the managed pane. They carry no authority by themselves.

Exclude by default:

- cloud, CI, package-registry, database, and service credentials;
- SSH/GPG agents and credential helper sockets;
- arbitrary `*_TOKEN`, `*_KEY`, and `*_SECRET` values;
- project `.env` files;
- proxy variables and cloud metadata endpoints;
- upstream Git authentication configuration.

Pi’s own model authentication may be resolved internally by the launched Pi runtime. Guarded tools cannot read Pi credential files or expose resolved keys. Authentication values are never placed in envelopes, artifacts, journals, UI, or subprocess environments.

### Filesystem policy

All tool-visible reads are contained within the canonical Rift workspace root unless the coordinator provides a specific read-only file capability. All writes require both workspace containment and one of:

- task-declared writable tracked paths;
- the attempt’s assigned ignored artifact output/evidence directories;
- explicit coordinator-owned conflict files during conflict resolution.

Always protected from agents:

- `.jj`, `.git`, `.rift`, coordinator journal/snapshot/transport state;
- artifact inputs and checksums;
- other runs/tasks/attempts;
- project/global Pi configuration and credentials;
- paths outside the Rift root.

Repository commands requiring VCS metadata are exposed as narrow operations (`status`, identity query, describe assigned change, permitted test diff) rather than general metadata file access.

Path checks resolve `..`, symlinks, hard-link-sensitive writes where detectable, case normalization, and existing-parent canonicalization before opening files. Open/write operations avoid check-then-use gaps where platform APIs permit. Output artifacts cannot be symlinks.

### Role capabilities

- **Decomposer:** contained read/search/list only; no process, network, write, Git mutation, or artifacts except its output.
- **Worker:** contained read/search; writes only declared task paths/artifacts; narrow `jj` change operations; approved command execution.
- **Reviewer:** contained read/search/diff; bounded test commands; artifact output; no tracked writes or revision mutation.
- **Result repair:** read current IDs and rewrite only the assigned output artifact; must prove task revision IDs/content did not change.
- **Conflict resolver:** worker capabilities limited to declared conflict paths and assigned task change; no unrelated stack expansion.

Project configuration may narrow these capabilities. Requests to expand tools flow through the exact approval policy and coordinator hard prohibitions.

### Command authorization

Commands use argv arrays and a coordinator policy of executable identity plus argument/cwd/environment constraints. There is no shell-string execution.

- Safe built-in policies cover narrow read-only inspection and configured project checks.
- Generic shells, interpreters with arbitrary code flags, package lifecycle installers, privilege escalation, process managers, remote execution, destructive filesystem commands, and upstream Git publication are denied by default.
- An unmatched but non-hard-prohibited command enters the Pi attention queue with exact executable path, argv, cwd, sanitized environment delta, task/attempt, and risk explanation.
- Approval applies only to that command fingerprint in that task attempt. It does not persist for the run, project, or global configuration.
- Any argv/cwd/env change creates a new fingerprint and approval request.
- Hard-prohibited actions cannot be approved in the first version.

Configured test commands are resolved and journaled before worker launch. If they transitively execute repository scripts, the approval UI discloses that repository-controlled code will run.

### Network

Network access is denied by default at command/tool policy level. Task-specific access requires an exact user-approved destination/protocol/command capability and is scoped to one attempt.

The first version does not claim kernel-level egress blocking. Commands capable of arbitrary networking remain denied unless explicitly approved with that limitation disclosed. Local coordinator communication with Herdr and the local Git transport is performed by coordinator adapters, not agent tools.

### Git and transport credentials

Workers receive no upstream Git, SSH, signing, or credential-helper authority. Publication is mediated by a narrow coordinator-controlled transport operation that can update only the assigned temporary bookmark in the run’s local bare repository using lease checks.

Agents cannot:

- add/change remotes;
- push arbitrary refs;
- contact upstream hosts;
- alter credential helpers;
- sign commits with user keys;
- delete transport refs.

The coordinator performs fetch, validation, integration, and ref cleanup.

### Hooks and setup

Rift postcreate hooks and repository setup hooks never run in the first version, even in trusted projects. Rift is always invoked with hooks disabled.

Exact dependency/setup commands, if later needed, must be modeled as ordinary coordinator-visible approved commands under a separate design. The extension does not execute `.rift.toml`, package install lifecycle hooks, shell initialization files, Git hooks, or project auto-detected setup commands implicitly.

### Reviewer cleanliness

The coordinator records reviewer tracked state before tests and verifies it afterward. Any tracked mutation fails the review invocation and reports exact changed paths. The coordinator does not silently revert and continue because test-induced mutation invalidates evidence about the reviewed revision.

Ignored/build output is allowed only inside reviewer-owned paths and is cleaned with the reviewer Rift.

### Secrets

General task secret access is unsupported in the first version. Users cannot approve exposure of `.env`, credential files, SSH agents, cloud metadata, registry tokens, or arbitrary parent environment values through project configuration or one-off prompts.

Only Pi’s internal model authentication exception is permitted, and guarded tools cannot inspect it. A future secret capability requires a separate threat model, redaction contract, destination binding, and audit design.

### Audit and redaction

Journal security-relevant facts include policy version/hash, resolved executable, argv fingerprint, cwd, sanitized environment keys, approval identity/time/scope, denials, path-capability IDs, and transport operations.

Never journal raw secrets, complete inherited environments, unbounded stdout/stderr, or sensitive file contents. UI and artifacts use schema-driven redaction. Project-controlled labels/output are sanitized before terminal rendering.

### Fail-closed behavior

Ambiguous canonical paths, unsupported platforms, missing guard extension, protocol mismatch, policy decode failure, unavailable containment checks, stale command approval, or unexpected tracked reviewer changes fail closed before the operation. Independent tasks may continue only when the failure is task-local and no run invariant is compromised.

## Map

[Effect-based Pi subagent orchestration](README.md)

## Unlocks

- [Specify the implementation route](specify-implementation-route.md)
