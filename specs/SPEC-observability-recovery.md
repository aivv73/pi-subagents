# SPEC-observability-recovery: Pi observability, attention, and recovery

Pi displays semantic orchestration state; Herdr displays live terminals. UI labels distinguish agent settlement, artifact validation, review, integration, and cleanup.

## Active runs

In TUI mode, a compact widget above the editor shows selected run state, grouped task counts, highest-priority attention, recovery/cleanup warning, and `/subagents` hint. A minimal footer status supplements it.

`/subagents` opens a responsive overlay for runs, tasks, attempts, reviews, integration, bounded journal details, and retained resources. Actions include inspect, pause dispatch, resume, cancel, eligible retry, recovery, and cleanup. Arbitrary graph/state editing is unsupported.

Selecting an agent shows semantic details and an explicit **Focus in Herdr** action after identity revalidation.

## Attention and notifications

Blocked agents, approvals, exhausted retries, conflicts, invalid recovery, and destructive cleanup enter an ordered attention queue. Arrival notifies and marks UI without stealing focus. `/subagents attention` opens a decision dialog with trusted context, bounded sanitized diagnostics, and explicit authority. Escape leaves it pending.

Notifications are configurable and default to attention, cleanup/recovery failures, and run terminal state. Adapter observations are deduplicated/rate-limited.

## Recovery and retention

The current startup scanner reports unfinished journals as paused with manual-cleanup guidance; it does not migrate, reconcile, resume, or delete them. Cancellation retains uncertain resources. Verified post-integration cleanup records complete success separately from a cleanup warning, which never rolls back integration.

Retained resources show task/attempt, reason, age/size, path/Herdr identity, and cleanup eligibility. Cleaning selected/eligible resources requires exact confirmation and records partial outcomes.

## Modes and transcript

TUI supports full widgets/overlays/dialogs. RPC exposes equivalent structured progress/actions. Print and JSON modes refuse before decomposition/resource creation.

Chat/tool rendering remains concise. Durable custom entries are limited to run creation, user decisions, recovery, and terminal summaries; detailed events remain in the journal.

All rendering is width-safe, theme-aware, keyboard/IME accessible, redacted, and sanitizes untrusted labels/output.

Persistence architecture follows [DESIGN-effect-event-sourcing](DESIGN-effect-event-sourcing.md).
