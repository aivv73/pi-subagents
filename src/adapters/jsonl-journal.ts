import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { reduce, replay, type RunState } from "../domain/reducer.js";
import { decodeJournalEvent, type JournalEvent, JournalDecodeError } from "../domain/schema.js";
import type { JournalEventDraft, RunJournal } from "../ports/journal.js";

export type { JournalEventDraft as EventDraft } from "../ports/journal.js";

export interface PausedJournal {
  readonly disposition: "paused";
  readonly runId: string;
  readonly journalPath: string;
  readonly state: RunState;
  readonly manualCleanupGuidance: string;
}

const repositoryIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export const repositoryStateDirectory = (homeDirectory: string, repositoryId: string): string => {
  if (!repositoryIdPattern.test(repositoryId)) {
    throw new Error("repository ID must be a path-safe stable identifier");
  }
  return join(resolve(homeDirectory), ".pi", "agent", "state", "pi-subagents", repositoryId);
};

export const journalPath = (stateDirectory: string, runId: string): string => {
  if (!repositoryIdPattern.test(runId)) throw new Error("run ID must be path-safe");
  return join(stateDirectory, "runs", `${runId}.jsonl`);
};

const decodeJsonLine = (line: string, filePath: string, lineNumber: number): JournalEvent => {
  try {
    return decodeJournalEvent(JSON.parse(line) as unknown);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new JournalDecodeError(`${filePath}:${lineNumber}: ${reason}`);
  }
};

export const readJournal = async (filePath: string): Promise<readonly JournalEvent[]> => {
  const content = await readFile(filePath, "utf8");
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.some((line) => line.length === 0)) {
    throw new JournalDecodeError(`${filePath}: journal contains a blank record`);
  }
  return lines.map((line, index) => decodeJsonLine(line, filePath, index + 1));
};

export class JsonlJournal implements RunJournal {
  #nextSequence: number;
  #appendTail: Promise<void> = Promise.resolve();
  #state: RunState | undefined;

  private constructor(
    readonly path: string,
    readonly runId: string,
    nextSequence: number,
    state: RunState | undefined,
  ) {
    this.#nextSequence = nextSequence;
    this.#state = state;
  }

  static async open(stateDirectory: string, runId: string): Promise<JsonlJournal> {
    const path = journalPath(stateDirectory, runId);
    await mkdir(dirname(path), { recursive: true });
    try {
      const events = await readJournal(path);
      const state = replay(events);
      if (state.runId !== runId) throw new JournalDecodeError("journal run ID does not match file name");
      return new JsonlJournal(path, runId, state.lastSequence + 1, state);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new JsonlJournal(path, runId, 1, undefined);
      throw error;
    }
  }

  append(draft: JournalEventDraft, now: Date = new Date()): Promise<JournalEvent> {
    const append = this.#appendTail.then(() => this.appendOne(draft, now));
    this.#appendTail = append.then(
      () => undefined,
      () => undefined,
    );
    return append;
  }

  async appendOne(draft: JournalEventDraft, now: Date): Promise<JournalEvent> {
    if (draft.correlationId !== this.runId) {
      throw new JournalDecodeError("journal event correlation ID must equal journal run ID");
    }
    const candidate = {
      schemaVersion: 1,
      runId: this.runId,
      sequence: this.#nextSequence,
      eventId: randomUUID(),
      timestamp: now.toISOString(),
      ...draft,
    };
    const event = decodeJournalEvent(candidate);
    const nextState = reduce(this.#state, event);
    const handle = await open(this.path, "a");
    try {
      await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    this.#nextSequence += 1;
    this.#state = nextState;
    return event;
  }
}

/** Reports interrupted runs for inspection only; it never resumes or removes them. */
export const findPausedJournals = async (stateDirectory: string): Promise<readonly PausedJournal[]> => {
  const runsDirectory = join(stateDirectory, "runs");
  try {
    const entries = await readdir(runsDirectory, { withFileTypes: true });
    const paused: PausedJournal[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const path = join(runsDirectory, entry.name);
      const state = replay(await readJournal(path));
      if (state.status === "succeeded" || state.status === "succeeded_with_cleanup_warning" || state.status === "failed" || state.status === "cancelled") continue;
      paused.push({
        disposition: "paused",
        runId: state.runId,
        journalPath: path,
        state,
        manualCleanupGuidance: "Run recovery is not available yet; inspect retained resources and clean them manually.",
      });
    }
    return paused;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};
