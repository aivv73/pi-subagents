# SPEC-observability-recovery: Pi observability, attention, and recovery

Pi displays semantic orchestration state; Herdr displays live terminals. UI labels distinguish agent settlement, artifact validation, review, integration, and cleanup.

## Active runs

In TUI mode, the current compact widget shows a semantic phase, exact integrated revision when known, retained resources when known, and bounded detail. Its phases distinguish worker execution, worker validation, review, integration, cleanup, blocked/failure, cancellation, success, and cleanup warning; Herdr idle/done is never semantic success. A passed preflight is explicitly labelled not dispatched while the command-to-coordinator binding remains absent.

`/subagents` opens a responsive overlay for runs, tasks, attempts, reviews, integration, bounded journal details, and retained resources. Actions include inspect, pause dispatch, resume, cancel, eligible retry, recovery, and cleanup. Arbitrary graph/state editing is unsupported.

Selecting an agent shows semantic details and an explicit **Focus in Herdr** action after identity revalidation.

## Attention and notifications

The current adapter emits bounded notifications for preflight failure, blocked/failure, cancellation, terminal success, and cleanup warning. Attention queues, overlay actions, and notification configuration are not implemented.

## Recovery and retention

The current startup scanner reports unfinished journals as paused with manual-cleanup guidance; it does not migrate, reconcile, resume, or delete them. Cancellation retains uncertain resources. Verified post-integration cleanup records complete success separately from a cleanup warning, which never rolls back integration.

Retained resources show task/attempt, reason, age/size, path/Herdr identity, and cleanup eligibility. Cleaning selected/eligible resources requires exact confirmation and records partial outcomes.

## Modes and transcript

TUI supports full widgets/overlays/dialogs. RPC exposes equivalent structured progress/actions. Print and JSON modes refuse before decomposition/resource creation.

Chat/tool rendering remains concise. Durable custom entries are limited to run creation, user decisions, recovery, and terminal summaries; detailed events remain in the journal.

All rendering is width-safe, theme-aware, keyboard/IME accessible, redacted, and sanitizes untrusted labels/output.

Persistence architecture follows [DESIGN-effect-event-sourcing](DESIGN-effect-event-sourcing.md).
