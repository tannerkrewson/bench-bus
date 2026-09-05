import { z } from "zod";
import { isoUtcTimestamp } from "./primitives";
import { SCHEMA_VERSIONS } from "./version";
import { intelligenceIndexVersionSchema, type ArtificialAnalysisModel } from "./aa";
import type { OpenRouterModelPricing } from "./openrouter";
import type { DeepSweScoreRecord } from "./deepswe";
import type { CursorEvalRecord } from "./cursor";

/** The four upstream sources Bench Bus collects, as a discriminated union tag. */
export const snapshotSourceSchema = z.enum(["aa", "openrouter", "deepswe", "cursor"]);
export type SnapshotSource = z.infer<typeof snapshotSourceSchema>;

/** Repo-relative path on the data branch. */
const dataBranchPath = z
  .string()
  .regex(/^[\w./-]+\.json$/, "must be a relative JSON file path (e.g. snapshots/aa/x.json)")
  .refine((v) => !v.startsWith("/"), { message: "path must be relative" });

/** Source metadata persisted alongside records when a collector provides it. */
export const snapshotSourceMetadataSchema = z
  .object({
    intelligenceIndexVersion: intelligenceIndexVersionSchema,
  })
  .strict();
export type SnapshotSourceMetadata = z.infer<typeof snapshotSourceMetadataSchema>;

/**
 * Versioned envelope persisted on the data branch for every successful,
 * fully-validated collection run.
 *
 * Deterministic-serialization contract: records are pre-sorted by their
 * collection validators; `JSON.stringify` of a parsed envelope is byte-stable
 * for identical upstream data (field order is fixed by the schema, timestamps
 * are UTC strings, no Dates or Maps).
 */
export const snapshotEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.snapshot),
    source: snapshotSourceSchema,
    /** Source-format schema version (SCHEMA_VERSIONS.aa | openrouter | deepswe | cursor). */
    recordSchemaVersion: z.number().int().positive(),
    observedAt: isoUtcTimestamp,
    records: z.array(z.unknown()),
    /** Currently populated for AA; omitted by older snapshots and other sources. */
    sourceMetadata: snapshotSourceMetadataSchema.optional(),
  })
  .refine(
    (env) =>
      (env.source === "aa" && env.recordSchemaVersion === SCHEMA_VERSIONS.aa) ||
      (env.source === "openrouter" && env.recordSchemaVersion === SCHEMA_VERSIONS.openrouter) ||
      (env.source === "deepswe" && env.recordSchemaVersion === SCHEMA_VERSIONS.deepswe) ||
      (env.source === "cursor" && env.recordSchemaVersion === SCHEMA_VERSIONS.cursor),
    { message: "recordSchemaVersion does not match the declared source" },
  );

export type SnapshotEnvelope = z.infer<typeof snapshotEnvelopeSchema>;

/** Wrap validated source payload records into a snapshot envelope. */
export function makeSnapshotEnvelope(input: {
  source: SnapshotSource;
  observedAt: string;
  records:
    | ArtificialAnalysisModel[]
    | OpenRouterModelPricing[]
    | DeepSweScoreRecord[]
    | CursorEvalRecord[];
  sourceMetadata?: SnapshotSourceMetadata;
}): SnapshotEnvelope {
  const recordSchemaVersion =
    input.source === "aa"
      ? SCHEMA_VERSIONS.aa
      : input.source === "openrouter"
        ? SCHEMA_VERSIONS.openrouter
        : input.source === "deepswe"
          ? SCHEMA_VERSIONS.deepswe
          : SCHEMA_VERSIONS.cursor;
  return {
    schemaVersion: SCHEMA_VERSIONS.snapshot,
    source: input.source,
    recordSchemaVersion,
    observedAt: input.observedAt,
    records: input.records as unknown[],
    ...(input.sourceMetadata ? { sourceMetadata: input.sourceMetadata } : {}),
  };
}

/**
 * Accept either a full SnapshotEnvelope or a collector source payload and
 * return envelope-shaped input for strict validation.
 *
 * Collectors emit source payloads (`{observedAt, source: {source, ...meta},
 * records}`); the data-branch store persists envelopes. The GitHub Actions
 * composite action pipes collector `--out` directly into `snapshot write`, so
 * the store accepts both shapes: anything already envelope-shaped passes
 * through untouched; a recognizable source payload is wrapped via
 * {@link makeSnapshotEnvelope}; anything else passes through and fails strict
 * envelope validation (fail closed).
 */
export function normalizeSnapshotInput(input: unknown): unknown {
  if (typeof input !== "object" || input === null) return input;
  const record = input as Record<string, unknown>;
  if (record.schemaVersion !== undefined) return input;
  const source = record.source;
  if (
    typeof source === "object" &&
    source !== null &&
    typeof (source as Record<string, unknown>).source === "string" &&
    typeof record.observedAt === "string" &&
    Array.isArray(record.records)
  ) {
    return makeSnapshotEnvelope({
      source: (source as Record<string, unknown>).source as SnapshotSource,
      observedAt: record.observedAt,
      records: record.records as never[],
      ...((source as Record<string, unknown>).source === "aa" &&
      ("intelligenceIndexVersion" in (source as Record<string, unknown>))
        ? {
            sourceMetadata: {
              intelligenceIndexVersion: (source as Record<string, unknown>)
                .intelligenceIndexVersion as string,
            },
          }
        : {}),
    });
  }
  return input;
}

/**
 * One entry in the data-branch snapshot manifest: an immutable snapshot file
 * at a deterministic path, e.g. `snapshots/aa/2026-08-21T015342Z.json`.
 */
export const manifestEntrySchema = z
  .object({
    observedAt: isoUtcTimestamp,
    path: dataBranchPath,
    schemaVersion: z.number().int().positive(),
  })
  .strict();

export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

/**
 * Manifest index for one source, stored on the data branch. Entries are
 * append-only history; `latestKnownGood` points at the newest snapshot that
 * fully validated, so a failed run can never move the pointer.
 */
export const snapshotManifestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.manifest),
    source: snapshotSourceSchema,
    entries: z.array(manifestEntrySchema).min(1),
    /** Pointer into `entries` (by observedAt) for the newest valid snapshot. */
    latestKnownGood: isoUtcTimestamp,
  })
  .refine(
    (manifest) => manifest.entries.some((e) => e.observedAt === manifest.latestKnownGood),
    { message: "latestKnownGood must reference an entry in entries" },
  );

export type SnapshotManifest = z.infer<typeof snapshotManifestSchema>;

/**
 * Resolve the newest manifest entry at or before the requested point in time
 * (point-in-time selection used by derived-data builds and time travel).
 * Returns undefined when the requested time precedes all collected history.
 */
export function resolveManifestEntryAt(
  manifest: Pick<SnapshotManifest, "entries">,
  atIsoUtc: string,
): ManifestEntry | undefined {
  const atMs = Date.parse(atIsoUtc);
  if (Number.isNaN(atMs)) {
    throw new TypeError(`Invalid requested timestamp: ${atIsoUtc}`);
  }
  let best: ManifestEntry | undefined;
  for (const entry of manifest.entries) {
    const entryMs = Date.parse(entry.observedAt);
    if (entryMs <= atMs && (best === undefined || entryMs > Date.parse(best.observedAt))) {
      best = entry;
    }
  }
  return best;
}

/** Convenience: the manifest's latest-known-good entry. */
export function resolveLatestKnownGood(
  manifest: SnapshotManifest,
): ManifestEntry | undefined {
  return manifest.entries.find((e) => e.observedAt === manifest.latestKnownGood);
}

// Re-exported for collector convenience: the per-source record array types
// that go inside an envelope's `records` field. Collectors validate records
// with the per-source collection validators before wrapping an envelope.
export type SnapshotRecords =
  | ArtificialAnalysisModel[]
  | OpenRouterModelPricing[]
  | DeepSweScoreRecord[]
  | CursorEvalRecord[];
