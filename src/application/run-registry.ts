/** One direct run is the only supported scheduling policy in the first slice. */
export class SingleRunRegistry {
  #activeRunId: string | undefined;

  claim(runId: string): { readonly _tag: "claimed" } | { readonly _tag: "already_active"; readonly runId: string } {
    if (this.#activeRunId !== undefined) return { _tag: "already_active", runId: this.#activeRunId };
    this.#activeRunId = runId;
    return { _tag: "claimed" };
  }

  release(runId: string): void {
    if (this.#activeRunId === runId) this.#activeRunId = undefined;
  }

  get activeRunId(): string | undefined {
    return this.#activeRunId;
  }
}
