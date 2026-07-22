# Herdr coordination primitives

## Answer

Herdr is a persistent terminal multiplexer with agent detection and automation—not a semantic multi-agent scheduler. It can create terminal topology, launch recognized agent processes, submit prompts, observe coarse lifecycle states, read terminal output, and keep processes alive across client detach. It does not define task graphs, dependency scheduling, structured agent results, retries, reviewer roles, or change integration.

Herdr can therefore serve as the **process host and human observability surface** for subprocess-based Pi workers. It cannot directly observe the in-process Pi SDK `AgentSession`s recommended by [Pi extension orchestration boundaries](pi-extension-orchestration.md), because Herdr agents are foreground processes recognized inside PTY panes. The project must choose the worker-hosting boundary explicitly.

## Reusable control surface

Herdr exposes the same capabilities through CLI wrappers and a local socket API. Its documentation recommends CLI first and raw sockets for custom clients or long-lived subscriptions.

### Layout

- `workspace create` creates a workspace, first tab, and root shell pane.
- `tab create` creates a tab and root pane.
- `pane split` creates additional terminals with a requested cwd, direction, environment, and focus behavior.
- Creation commands return JSON containing generated IDs. Callers must capture these IDs rather than predict them.

This maps naturally to one orchestration run/workspace, worker/reviewer tabs, and one pane per subprocess, but Herdr imposes no such semantics itself.

### Agent lifecycle

- `agent start NAME --kind pi --pane PANE -- ARGS...` starts Pi in an existing available shell pane and waits until Herdr detects it as ready.
- Live agent names are unique aliases matching `[a-z][a-z0-9_-]{0,31}`; pane IDs are the durable terminal location for the current session.
- `agent prompt` writes prompt text through the interactive terminal and can atomically wait for lifecycle status.
- `agent wait` observes `idle`, `working`, `blocked`, `done`, or `unknown` and pins the resolved pane occupant so a replacement process cannot satisfy an old wait.
- `agent send-keys` supports interactive cancellation/approval keystrokes; `pane send-*` provides raw terminal control.
- `agent read` and `pane read` return rendered terminal snapshots, not structured model messages.

Herdr explicitly does not track individual turns. If an agent is already working, `agent prompt --wait` may be satisfied by completion of the existing turn. `unknown` does not imply success. Default waits accept `idle`, `done`, or `blocked`, so the adapter must request exact statuses and apply explicit timeouts.

### Events and snapshots

- `session.snapshot` bootstraps workspace, tab, pane, layout, focus, and agent records with protocol/version metadata.
- Clients then subscribe to resource events such as `pane.agent_detected`, `pane.agent_status_changed`, `pane.exited`, and workspace/tab/pane lifecycle events.
- After reconnect or suspected event loss, clients should request a fresh snapshot.
- `agent.prompt` with an embedded wait avoids the race between separate prompt and wait requests.
- Server handoff interrupts in-flight requests, waits, subscriptions, and sockets; clients must reconnect and retry safely.

## Pi support

Pi is a recognized `agent start --kind pi` executable and has an agent-detection manifest. The checked-in default manifest is minimal: it identifies visible `Working...` text as working. Stronger lifecycle/session behavior depends on Herdr’s optional Pi integration reporting authoritative state and native session references.

Herdr can resume integration-reported Pi sessions after a full server restart with `pi --session <path-or-id>`. Without that integration, restart restores layout and new shells, not running Pi processes or conversations. Normal client detach is stronger: the server and original PTYs continue running.

## Missing orchestration semantics

Herdr supplies no native primitive for:

- decomposing a user goal;
- storing a DAG or enforcing task dependencies;
- limiting concurrency independently of pane count;
- typed task inputs or structured outputs;
- distinguishing successful completion from an idle terminal;
- bounded retries or feedback routing;
- assigning reviewer authority;
- accepting/rejecting changes;
- associating a process with Rift or `jj` identities;
- merging or integrating revisions.

These remain Effect coordinator responsibilities. Herdr statuses should be treated as operational telemetry and attention signals, not as authoritative domain results.

## Output and correctness constraints

- Terminal reads default to recent rendered rows. Full-screen alternate-screen UIs may lose earlier response text from host scrollback.
- The documented fallback is asking an agent to write complete Markdown to a temporary file, but that is still prompt convention rather than a typed result protocol.
- A robust coordinator should have each Pi worker write a structured result artifact or use Pi JSON/RPC output. Scraping terminal output should be limited to display and diagnostics.
- Waits have no default timeout. Every coordinator call needs an Effect timeout and interruption mapping.
- A pane must be at an available interactive shell before `agent start`; occupied panes are not generic process slots.
- Moving a pane across workspaces changes its public pane ID and terminates an in-flight agent wait with `agent_not_running`.

## Suitable integration boundaries

### Herdr-hosted Pi subprocesses

Create panes with Rift workspace cwd, start named Pi agents, and use Herdr for PTY ownership, persistence, lifecycle telemetry, and human inspection. Use a separate structured Pi channel/artifact for authoritative results. This provides the intended Herdr experience but gives up the initial simplicity of in-process SDK workers.

### Optional observability mirror

Keep SDK workers authoritative and expose coordinator status to Herdr through metadata/plugins or ordinary monitoring panes. Herdr would not actually host or recognize those workers, so this is weaker than the requested “Herdr coordinates subagents” role.

### Dual runtime adapter

Define a worker-runtime interface with SDK and Herdr-process implementations. This preserves testability and permits interactive Herdr operation, but increases lifecycle and parity obligations substantially.

## Licensing boundary

Herdr is AGPL-3.0-or-later with a commercial-license option. Integrating by invoking a separately installed binary over its public CLI/socket API is technically cleaner than embedding Herdr source, but distribution and network-use obligations need explicit legal/product review before packaging decisions.

## Recommended constraints for later decisions

1. Keep task graph, reviewer protocol, retries, and result schemas in Effect; do not infer them from Herdr state.
2. If Herdr hosts workers, use one named agent per pane and map coordinator IDs to the returned workspace/tab/pane IDs.
3. Treat `agent.prompt --wait` as attention/liveness control only; require a separate structured completion artifact.
4. Set exact wait states and finite timeouts, and handle `blocked` as an escalation signal rather than completion.
5. Bootstrap with `session.snapshot`, subscribe to events, and reconcile after reconnect/handoff.
6. Preserve a process-runtime adapter boundary because Herdr hosting and in-process Pi SDK sessions are mutually different execution models.

## Evidence

- Product boundary and license: `https://github.com/ogulcancelik/herdr/blob/master/README.md`
- Workspace, pane, agent, session, and state model: `https://github.com/ogulcancelik/herdr/blob/master/docs/next/website/src/content/docs/concepts.mdx`
- Automation behavior and caveats: `https://github.com/ogulcancelik/herdr/blob/master/docs/next/website/src/content/docs/agent-automation.mdx`
- Socket methods, snapshots, waits, and events: `https://github.com/ogulcancelik/herdr/blob/master/docs/next/website/src/content/docs/socket-api.mdx`
- Persistence and Pi resume behavior: `https://github.com/ogulcancelik/herdr/blob/master/docs/next/website/src/content/docs/session-state.mdx`
- Typed agent request/response schema: `https://github.com/ogulcancelik/herdr/blob/master/src/api/schema/agents.rs`
- Pi screen-detection manifest: `https://github.com/ogulcancelik/herdr/blob/master/website/agent-detection/pi.toml`

