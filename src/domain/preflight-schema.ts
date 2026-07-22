import { Schema } from "effect";

/** The installed Herdr socket schema header, decoded independently of repository docs. */
export const HerdrSchemaHeader = Schema.Struct({
  protocol: Schema.Number,
  schema_version: Schema.Number,
  schemas: Schema.Struct({
    request: Schema.Unknown,
    event: Schema.Unknown,
  }),
});

export type HerdrSchemaHeader = Schema.Schema.Type<typeof HerdrSchemaHeader>;

export const decodeHerdrSchemaHeader = (value: unknown): HerdrSchemaHeader =>
  Schema.decodeUnknownSync(HerdrSchemaHeader)(value);
