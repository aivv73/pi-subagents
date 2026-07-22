# Define orchestration observability and Pi UI

**Type:** grilling  
**Status:** closed  
**Blocked by:** [Prototype one parallel orchestration cycle](prototype-parallel-cycle.md)

## Question

Which semantic progress, Herdr links, blocked/revision/conflict prompts, recovery summaries, and retained-resource actions must the Pi extension expose without duplicating Herdr’s terminal UI?

## Resolution

### UI responsibility

Pi displays semantic orchestration state and decisions. Herdr displays live terminals and raw agent interaction. The extension never embeds or re-renders terminal output as its primary UI.

Wording must consistently distinguish:

- **agent working/settled/blocked** — Herdr observations;
- **result missing/invalid/validated** — artifact protocol;
- **review requested/approved/rejected** — reviewer authority;
- **integration pending/conflicted/integrated** — repository state;
- **cleanup pending/retained/complete** — resource ownership.

No green/success state is derived solely from Herdr `idle` or `done`.

### Persistent active-run widget

While at least one run is active or paused, use `ctx.ui.setWidget()` above the editor. Keep it compact and responsive:

```text
subagents  run api-refactor  ● running
tasks  2 running · 1 review · 3 integrated · 1 blocked
attention  auth-tests: approval needed
open /subagents · terminals in Herdr
```

The widget shows:

- selected/default run label and semantic run state;
- task counts grouped by meaningful state;
- highest-priority attention item;
- cleanup/recovery warning when present;
- command hint, not raw paths or verbose findings.

If multiple runs exist, show aggregate counts and the most urgent run. Narrow terminals collapse to one status line. Widget rendering is cached, width-safe, theme-aware, and refreshed from reduced domain state rather than adapter callbacks.

Use `ctx.ui.setStatus()` for a minimal footer indicator such as `subagents 2▶ 1!`; do not replace Pi’s footer or editor.

### Commands and overlay

Register one command family:

```text
/subagents                 open run/task overlay
/subagents attention       open highest-priority decision
/subagents pause [run]
/subagents resume [run]
/subagents cancel [run]
/subagents retry <task>
/subagents cleanup [run]
/subagents recover
```

`/subagents` opens a responsive custom overlay using existing Pi TUI components. Primary hierarchy:

1. runs;
2. tasks in deterministic graph/scheduling order;
3. attempts, reviews, integration, and retained resources;
4. bounded journal/event details.

Task detail includes semantic state, dependencies/dependents, assigned base, exact result/review/integration IDs, checks, findings, retry budgets, Herdr identity, Rift path, and cleanup ownership. Sensitive values are redacted through schema policy.

The overlay supports inspect, pause dispatch, resume, cooperative cancel, retry an eligible failed task, and cleanup. It does not support arbitrary graph editing or manual state mutation.

### Herdr handoff

Selecting an agent first opens semantic details. An explicit **Focus in Herdr** action invokes the supported Herdr focus command after confirming the pane still hosts the expected terminal/agent identity. Failure leaves Pi focused and displays an actionable stale-resource message.

Pi displays human-readable agent/task labels plus short IDs. Full pane/workspace IDs and paths appear only in expanded details/copy actions.

### Attention queue

Blocked prompts, user approvals, exhausted retries, conflicts, invalid recovery state, and destructive cleanup confirmations enter a coordinator-owned attention queue ordered by severity then event sequence.

- Do not steal focus when an item arrives.
- Notify, mark the widget/status, and continue independent branches.
- Open a decision dialog only when the user selects the item or invokes `/subagents attention`.
- The dialog shows the task, role, trusted semantic context, a bounded/redacted terminal snapshot for diagnostics, and explicit choices.
- Approval actions state exactly which command/resource they authorize and whether they resume the same agent.
- Escape keeps the item pending; it never implies approval or cancellation.

### Notifications

Notification policy is configurable. Quiet defaults notify only:

- user attention required;
- cleanup or recovery failure;
- run terminal state.

Optional levels add task completion, review decisions, conflicts, retries, and all semantic transitions. Deduplicate repeated adapter observations and rate-limit notifications per run. Terminal details remain in Herdr.

### Recovery overlay

On startup, after journal replay and external reconciliation, show one recovery overlay summarizing all unfinished runs. Each row includes:

- last durable semantic state and timestamp;
- active/missing Herdr resources;
- Rift/Git/`jj` drift;
- intents without outcomes;
- retained resources and cleanup risk;
- recommended safe action.

Actions are **Inspect**, **Resume**, **Keep paused**, and **Cancel and clean**. Multi-select may apply a safe common action. Resume always requires explicit confirmation and only becomes enabled after reconciliation finds no unresolved invariant violation.

### Retained-resource management

The overlay includes a retained-resources view with task/attempt, path, Herdr identity, reason, age, size when cheaply available, and cleanup eligibility.

Actions:

- **Open details**;
- **Focus in Herdr** when still live;
- **Clean selected**;
- **Clean eligible** according to policy.

Destructive cleanup always presents the exact resources and requires confirmation. Cleanup streams progress, remains cancellable between resources, records partial outcomes, and never invokes Rift source-root unregister behavior.

### Tool rendering and chat transcript

The orchestration custom tool uses concise `renderCall`/`renderResult` components:

- collapsed: run ID/label, current phase, counts, terminal result;
- expanded: task summary, integrations, failures, retained resources, and usage;
- live updates: bounded semantic progress through `onUpdate`.

Do not append every task transition to chat. Persist durable non-LLM UI records with custom entries only for run creation, user decisions, recovery, and terminal summary. Detailed events remain in the journal and overlay.

### Mode behavior

- **TUI:** full widget, status, overlay, dialogs, and notifications.
- **RPC:** orchestration is supported; emit structured state/progress and expose equivalent command/action requests through Pi’s RPC extension UI protocol. Custom TUI overlays are not assumed available.
- **Print/JSON:** fail before decomposition or Rift creation with an actionable message directing the user to TUI or RPC. These one-shot modes cannot safely handle attention, recovery, or retained-resource decisions.

All UI methods check `ctx.mode`/`ctx.hasUI`; terminal-specific components are never created in RPC/print/JSON modes.

### Accessibility and safety

- Use text labels/icons together; color is never the sole state signal.
- Preserve theme invalidation and terminal width constraints.
- Keep keyboard navigation, Escape cancellation, and IME focus behavior consistent with Pi components.
- Confirm destructive or authority-changing actions.
- Never render secrets, full environment variables, credentials, unbounded terminal output, or raw untrusted ANSI.
- Sanitize project/task/agent labels before terminal rendering.

## Map

[Effect-based Pi subagent orchestration](README.md)

## Unlocks

- [Specify the implementation route](specify-implementation-route.md)
