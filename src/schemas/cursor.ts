import { z } from "zod";
import { finiteNumber, isoUtcTimestamp, nonEmptyString, optionalFiniteNumber } from "./primitives";

/**
 * Canonical Cursor eval record, parsed from the single benchmark table at
 * https://cursor.com/evals (the authoritative source for CursorBench).
 *
 * DESIGN ASSUMPTIONS (documented because the table's published columns may
 * evolve; the collector parser must map the live table onto these fields and
 * fail closed if it cannot):
 *
 * - `score` is the published CursorBench score (0-100 scale as displayed).
 * - `inputTokens`/`outputTokens` are the per-task benchmark workload token
 *   counts the table publishes (or from which workload cost is computed).
 *   When the table publishes only aggregate cost, the parser records the
 *   published cost in `publishedCostUsd` and leaves token counts undefined;
 *   downstream cost estimation must then use the published cost directly.
 * - `tokensPerTask`/`stepsPerTask` preserve the table's aggregate raw figures
 *   (never split into input/output); the surcharge calculation sources its
 *   token volume from these aggregates when input/output splits are absent.
 * - `provider` is the serving provider shown in the table (e.g. "cursor",
 *   "openai", "anthropic"); `modelId` is the table's row identity.
 * - `isThirdParty` marks models Cursor serves via a third-party API rather
 *   than first-party infra. The optional $0.25/M-token Cursor surcharge is
 *   applied downstream ONLY to these rows; it is never baked into raw values.
 * - RAW vs DERIVED: raw scraped values live in the fields below; any computed
 *   cost (surcharge included or not) is derived at chart build time and must
 *   not be written back into these records.
 */
export const cursorEvalRecordSchema = z
  .object({
    /** Row identity from the cursor.com/evals table. */
    modelId: nonEmptyString,
    /** Display name as published. */
    modelName: nonEmptyString,
    provider: nonEmptyString,
    /** True when Cursor serves this model via a third-party API. */
    isThirdParty: z.boolean(),
    /** Published CursorBench score (0-100). */
    score: finiteNumber.refine((v) => v >= 0 && v <= 100, {
      message: "score must be within [0, 100]",
    }),
    inputTokens: optionalFiniteNumber,
    outputTokens: optionalFiniteNumber,
    /** Cost per benchmark task as published by Cursor, USD, when present. */
    publishedCostUsd: optionalFiniteNumber,
    /** Published aggregate tokens per task (raw display value), when present. */
    tokensPerTask: optionalFiniteNumber,
    /** Published aggregate steps per task (raw display value), when present. */
    stepsPerTask: optionalFiniteNumber,
  })
  .strict();

export type CursorEvalRecord = z.infer<typeof cursorEvalRecordSchema>;

/** Identity key used for deterministic dedup of Cursor eval records. */
export function cursorEvalIdentityKey(record: Pick<CursorEvalRecord, "modelId">): string {
  return record.modelId;
}

/**
 * Validate a full Cursor eval table parse: every row individually valid, no
 * duplicate identity keys, sorted by modelId for deterministic serialization.
 */
export function validateCursorEvalCollection(records: unknown): CursorEvalRecord[] {
  if (!Array.isArray(records)) {
    throw new TypeError("Cursor eval collection must be an array");
  }
  const seen = new Map<string, number>();
  const parsed = records.map((record, index) => {
    const result = cursorEvalRecordSchema.safeParse(record);
    if (!result.success) {
      throw new Error(`Invalid Cursor eval record at index ${index}: ${result.error.message}`);
    }
    const key = cursorEvalIdentityKey(result.data);
    const firstAtIndex = seen.get(key);
    if (firstAtIndex !== undefined) {
      throw new Error(
        `Duplicate Cursor eval identity "${key}" at indices ${firstAtIndex} and ${index}`,
      );
    }
    seen.set(key, index);
    return result.data;
  });
  return parsed.sort((a, b) => cursorEvalIdentityKey(a).localeCompare(cursorEvalIdentityKey(b)));
}

/** Source metadata stamped onto every Cursor snapshot. */
export const cursorSourceMetadataSchema = z
  .object({
    source: z.literal("cursor"),
    pageUrl: z.literal("https://cursor.com/evals"),
  })
  .strict();

export type CursorSourceMetadata = z.infer<typeof cursorSourceMetadataSchema>;

/** Full Cursor snapshot payload as persisted by the collector. */
export const cursorSnapshotPayloadSchema = z.object({
  observedAt: isoUtcTimestamp,
  source: cursorSourceMetadataSchema,
  records: z.array(cursorEvalRecordSchema),
});

export type CursorSnapshotPayload = z.infer<typeof cursorSnapshotPayloadSchema>;
