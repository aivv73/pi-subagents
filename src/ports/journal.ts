import type { EventPayload, JournalEvent } from "../domain/schema.js";

/** Durable run-event boundary; adapters must append before reporting a mutation outcome. */
export interface JournalEventDraft {
  readonly causationId: string;
  readonly correlationId: string;
  readonly payload: EventPayload;
}

export interface RunJournal {
  readonly path: string;
  readonly runId: string;
  append(draft: JournalEventDraft, now?: Date): Promise<JournalEvent>;
}
