# Pi extension orchestration boundaries

## Answer

Pi supports the coordinator shell as an extension, while worker agents should run through the exported SDK (preferred for same-process typed control) or isolated Pi subprocesses (the existing example). The extension API itself controls the parent session; independent worker lifecycles come from `createAgentSession()`/`AgentSession`, not from parent-session event hooks.

## Supported coordinator surface

- Register a slash command for explicit orchestration entry and a custom tool for model-initiated delegation. Commands receive `ExtensionCommandContext`; tools receive an abort signal and progress callback.
- A command can `waitForIdle()` before changing coordinator state. Session replacement methods are command-only because event-handler use can deadlock.
- Custom tool execution supports streamed `onUpdate` details, nested-model usage accounting, thrown errors, and `terminate: true`. Tool calls run in parallel by default.
- `ctx.ui` provides notifications, status, widgets, dialogs, and custom TUI components. Terminal-specific UI must be guarded by `ctx.mode === "tui"`; dialogs and notifications must account for `ctx.hasUI` and RPC/print behavior.
- `pi.appendEntry()` persists coordinator metadata outside LLM context. State can be reconstructed from custom entries or tool-result details during `session_start`; tool-result details preserve branch-aware state.
- Start long-lived resources only at `session_start` or on demand. Close processes, watchers, and scopes idempotently in `session_shutdown`, which runs for quit, reload, and session replacement.
- Project-local configuration and agent prompts must only be honored after checking project trust. Extensions themselves run with full user permissions.

## Worker execution choices

### Preferred: in-process SDK sessions

`createAgentSession()` creates an independent `AgentSession` with its own context, cwd, tools, model, settings, and in-memory or persistent `SessionManager`. It provides:

- `prompt()` that resolves after the accepted run, including retries;
- event subscriptions for messages, tools, turns, retries, and compaction;
- `abort()` and `dispose()` lifecycle controls;
- an explicit custom `cwd`, suitable for a Rift workspace;
- tool allowlists and custom tools;
- in-memory sessions for disposable workers.

A coordinator should construct a deliberate `ResourceLoader` for workers rather than use unrestricted default discovery. Otherwise each worker can rediscover the orchestration extension and project-controlled resources recursively. Worker sessions need only the agreed tools, system prompt, context, and credentials.

The SDK is explicitly documented for tools that spawn subagents and is preferred over RPC when type safety and same-process state access matter. Effect scopes can own each `AgentSession`, map interruption to `abort()`, and guarantee `dispose()`.

### Alternative: isolated Pi processes

Pi’s bundled subagent extension launches `pi --mode json -p --no-session` per worker, passes a worker cwd, parses JSON events, limits concurrency, streams partial details, and propagates cancellation with `SIGTERM` followed by `SIGKILL`. This is proven and gives process isolation, but requires manual process supervision and protocol parsing.

RPC subprocesses provide a richer long-lived protocol and stronger process isolation. They are appropriate if crashing or untrusted worker code must not share the coordinator process. The architecture decision should select SDK versus subprocess isolation explicitly rather than mix them accidentally.

## Lifecycle and cancellation constraints

- Parent `ctx.signal` exists during active turn/tool events but is usually absent in idle commands and session events. A command-started orchestration therefore needs its own cancellation scope and UI/command cancellation path.
- Esc cancellation can propagate naturally from a custom tool’s `signal`; nested model calls and process operations must receive that signal.
- `agent_end` is too early for completion because automatic retry, compaction, or queued follow-ups may continue. Use `agent_settled` for parent status and await `AgentSession.prompt()`/idle for workers.
- Parent session reload, switch, fork, and shutdown tear down the old extension instance. Captured parent `pi`, context, and `SessionManager` objects become stale after replacement.
- Pi does not provide a built-in distributed task graph, reviewer protocol, workspace ownership model, or crash-recovery journal. Those remain extension responsibilities.

## Recommended boundary for this project

1. Expose one coordinator command and a narrow orchestration tool.
2. Keep task graph, Herdr adaptation, and Rift/`jj` workspace management in Effect services independent of Pi UI types.
3. Represent each worker/reviewer as an SDK `AgentSession` initially, with an adapter boundary permitting subprocess isolation later.
4. Give every worker the Rift workspace as `cwd`, an in-memory Pi session, an explicit tool allowlist, and a restricted resource loader.
5. Stream structured progress through tool `onUpdate`; persist only compact orchestration checkpoints via custom entries/tool details.
6. Tie all running sessions/processes to an Effect scope closed by cancellation and `session_shutdown`.

## Evidence

- Pi extension API and lifecycle: `/opt/pi-coding-agent/docs/extensions.md`
- Pi SDK sessions, tools, cancellation, and subprocess tradeoff: `/opt/pi-coding-agent/docs/sdk.md`
- Existing isolated and parallel subagent implementation: `/opt/pi-coding-agent/examples/extensions/subagent/README.md`
- Existing worker spawning, JSON event handling, concurrency, progress, trust prompts, and abort propagation: `/opt/pi-coding-agent/examples/extensions/subagent/index.ts`
- Existing user/project agent discovery: `/opt/pi-coding-agent/examples/extensions/subagent/agents.ts`

