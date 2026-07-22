import type { AttemptEnvelope } from "../domain/artifact-schema.js";

export interface AttemptArtifacts {
  readonly root: string;
  readonly directory: string;
  readonly inputPath: string;
  readonly checksumPath: string;
  readonly outputPath: string;
  readonly evidenceDirectory: string;
  readonly envelope: AttemptEnvelope;
}
