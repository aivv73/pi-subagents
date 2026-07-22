# SPEC-trust-permissions: Trust and agent capabilities

Orchestration is unavailable until Pi reports the project trusted. The extension does not read project orchestration configuration or create journals, workspaces, transports, panes, or agents before trust.

## Child runtime

Child Pi runs with built-in tools and project resource discovery disabled. A coordinator-owned extension supplies guarded role-specific tools. It canonicalizes paths, mediates argv process policies, constructs environment, protects metadata/artifacts, and reports denials structurally.

This is not a hostile-code OS sandbox. Approval of an executable may authorize behavior beyond wrapper visibility; the UI must disclose that limitation.

## Files and roles

Reads are contained in the canonical Rift root. Writes require task-declared tracked paths or the owned artifact area. `.jj`, `.git`, `.rift`, input envelopes, journals, transports, credentials, other attempts, and paths outside the root are protected.

Decomposers are read-only. Workers receive scoped mutation and command capabilities. Reviewers may read and run bounded checks but may not mutate tracked state. Repair may write only its output artifact. Conflict resolution writes only assigned conflict/task paths.

Project configuration may narrow capabilities; expansions require policy approval.

## Environment, commands, and network

Agents receive a minimal constructed environment. General secrets, `.env`, SSH/GPG agents, cloud/registry/database credentials, proxies, and upstream Git authentication are excluded. Pi may internally resolve model authentication, which tools cannot inspect.

Commands use argv arrays and executable/argument/cwd/environment policies. Unmatched non-prohibited commands require an exact task-attempt fingerprint approval. Approvals do not persist outside that attempt. Generic shells/interpreters, privilege escalation, destructive commands, lifecycle installers, remote execution, and upstream publication are denied by default.

Network access is denied by default and any exception is exact and attempt-scoped. The first version does not claim kernel-level egress enforcement.

Rift/repository setup hooks never execute in the first version. Reviewer tests that mutate tracked files fail review.

## Fail closed and audit

Ambiguous paths, stale approvals, policy/schema failures, unsupported enforcement, missing guard extension, or unexpected reviewer mutation fail closed. Journals record policy hashes, command fingerprints, sanitized environment keys, approvals/denials, and transport actions without secrets or unbounded output.

UI requirements for approval are specified in [SPEC-observability-recovery](SPEC-observability-recovery.md).

