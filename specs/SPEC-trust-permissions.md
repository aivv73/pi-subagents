# SPEC-trust-permissions: Trust and agent capabilities

Orchestration is unavailable until Pi reports the project trusted. The extension rejects an untrusted project before invoking any operating-system probe, reading project orchestration configuration, or creating journals, workspaces, transports, panes, or agents. After trust, its read-only preflight also requires TUI mode, non-empty task text, and configured authentication for the active parent model before inspecting repository or external-tool facts.

## Child runtime

Child Pi launch arguments disable built-in tools and all discovered project/global extensions, skills, prompt templates, context files, themes, and project approval. The only explicit child extension supplies guarded role-specific tools. It canonicalizes paths, rejects symlink paths, constructs a minimal environment, protects metadata/artifacts, and reports denials structurally.

This is not a hostile-code OS sandbox. Approval of an executable may authorize behavior beyond wrapper visibility; the UI must disclose that limitation.

## Files and roles

Reads/searches are contained in the canonical child root. `.jj`, `.git`, `.rift`, `.pi-subagents`, credential/secret paths, environment files, symlinks, and paths outside the root are protected. Worker writes are exact declared tracked paths only; both roles may write only their fixed result artifact through the coordinator protocol.

Workers receive contained read/search/edit/write plus narrow Jujutsu identity/describe tools. Reviewers receive contained read/search and a fixed read-only Jujutsu diff. Reviewers cannot mutate tracked state. No other role or project configuration is supported yet.

## Environment, commands, and network

Agents receive a constructed allowlist environment containing only runtime locale/terminal paths, home/config locations for Pi's internal model resolution, and coordinator guard configuration. General secrets, `.env`, SSH/GPG agents, cloud/registry/database credentials, proxies, and upstream Git authentication are excluded. Tools expose no environment inspection capability.

There is no general process, shell, interpreter, network, approval, or project-command tool. The only child process use is fixed-argv Jujutsu identity/describe for a worker and fixed-argv diff for a reviewer. Pi may internally resolve model authentication, which tools cannot inspect. The first version does not claim kernel-level egress enforcement.

Rift/repository setup hooks never execute in the first version. Reviewer tests that mutate tracked files fail review.

## Fail closed and audit

Ambiguous paths, stale approvals, policy/schema failures, unsupported enforcement, missing guard extension, or unexpected reviewer mutation fail closed. Journals record policy hashes, command fingerprints, sanitized environment keys, approvals/denials, and transport actions without secrets or unbounded output.

UI requirements for approval are specified in [SPEC-observability-recovery](SPEC-observability-recovery.md).
