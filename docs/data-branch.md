# Data branch convention (`bench-bus-data`)

Bench Bus keeps two strictly separated kinds of content:

| Content | Branch | Authored by |
| --- | --- | --- |
| Application code, schemas, collectors, workflows, tests, docs | `main` (default) | Humans + agents |
| Immutable timestamped source snapshots + manifests | `bench-bus-data` | GitHub Actions collectors only |

`bench-bus-data` is **not** a deployment branch. The site is built from `main`
plus data read out of `bench-bus-data` and deployed as a GitHub Pages artifact;
no compiled site output is ever committed to the data branch.

## Directory layout

```
manifests/<source>.json                                  # per-source index + latest-known-good pointer
snapshots/<source>/v<recordSchemaVersion>/<YYYYMMDDTHHMMSSZ>.json
```

- `<source>` is one of `aa`, `openrouter`, `cursor`.
- `<recordSchemaVersion>` matches the per-source version in
  `src/schemas/version.ts` (`SCHEMA_VERSIONS`), so differently-versioned
  record formats never share a directory.
- File names use compact UTC time (`20260821T015342Z`, sub-second truncated),
  derived deterministically from the envelope's `observedAt` — identical
  observations always map to identical paths.

## Snapshot envelope

Each snapshot file contains one `SnapshotEnvelope`
(`src/schemas/snapshot.ts`):

```json
{
  "schemaVersion": 1,
  "source": "aa",
  "recordSchemaVersion": 1,
  "observedAt": "2026-08-21T01:53:42.000Z",
  "sourceMetadata": { "intelligenceIndexVersion": "4.2" },
  "records": [ ... ]
}
```

`records` are fully validated with the shared per-source contracts before the
file is written, and are stored in a deterministic order (AA by `slug`,
OpenRouter by `aaModelSlug`, Cursor by `modelId`), so identical upstream data
always serializes to identical bytes. AA snapshots include the source-wide
`intelligenceIndexVersion` when the collector discovers it. Older snapshots
may omit this metadata and are treated as unknown-generation history.

## Manifest

`manifests/<source>.json` is the only index used for resolution:

```json
{
  "schemaVersion": 1,
  "source": "aa",
  "entries": [
    { "observedAt": "2026-08-20T03:00:00.000Z", "path": "snapshots/aa/v1/20260820T030000Z.json", "schemaVersion": 1 }
  ],
  "latestKnownGood": "2026-08-20T03:00:00.000Z"
}
```

- `entries` is append-only history.
- `latestKnownGood` points at the newest entry that **fully validated**. A
  failed or invalid run can never move it.

## Write protocol (collectors / Actions)

1. Collect upstream data; on any failure, exit nonzero and change nothing.
2. Validate records with the shared schemas and wrap them in an envelope
   stamped with the run's UTC `observedAt`.
3. In a checkout of `bench-bus-data`, run:
   `tsx src/snapshots/cli.ts write --dir . --input envelope.json`
   The store validates again, refuses to overwrite any existing snapshot path
   or duplicate manifest entry, writes the snapshot atomically, then appends
   the manifest entry and moves `latestKnownGood` atomically.
4. Commit atomically:
   `tsx src/snapshots/cli.ts commit --repo . --message "collect: <source> <observedAt>"`
   The commit step refuses to run unless `bench-bus-data` is the checked-out
   branch (`--any-branch` overrides for local experimentation).

### Failure semantics

- Validation failure → nothing is written; previous data and pointers are
  untouched; the workflow exits nonzero.
- Crash between snapshot-file write and manifest write → the file becomes an
  **orphan**. Resolution only trusts the manifest, so orphans are never
  served; `listOrphans()` (or a future workflow step) surfaces them.
- Empty collections are rejected by default (`--allow-empty` / `allowEmpty`
  to override) so an upstream shape change cannot shadow the last
  known-good data with an empty "newer" snapshot.

## Point-in-time resolution

`store.resolveSnapshot(source, asOf)` returns the newest valid snapshot of
that source at or before `asOf`, re-validating the file before returning
(fail closed on corruption). Each source resolves **independently** — a
historical view combines each source's own latest eligible snapshot and does
not require timestamp alignment across sources. Times before a source's first
collected snapshot resolve to `undefined`; Bench Bus history intentionally
begins at the first Bench Bus collection (no OpenRouter backfill).

## First run / initialization

`tsx src/snapshots/cli.ts init --dir .` creates the `snapshots/` and
`manifests/` skeleton and is idempotent; manifests appear with the first
snapshot per source. Branch creation/checkout is owned by the caller
(Actions workflows or developers) — the CLI never switches branches.

## Retention / compaction

Source snapshots are permanent by default and are never deleted by the store.
`compactManifest()` only normalizes a manifest (sort, drop duplicate entries)
while preserving `latestKnownGood`. If storage ever requires pruning, it must
be an explicit, separately-reviewed workflow step operating on explicit
`observedAt` ranges — never a side effect of collection.
