# Schema assets

This directory is intentionally published from the first package release onward.
The version-one Effect schemas for direct-run commands and append-only journal events
are implemented in `src/domain/schema.ts`; the installed-Herdr schema header decoder is
in `src/domain/preflight-schema.ts`. Artifact and review contract schemas arrive with
their corresponding worker/reviewer slices.
