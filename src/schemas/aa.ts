import { z } from "zod";
import { finiteNumber, isoUtcTimestamp, nonEmptyString } from "./primitives";

/**
 * Canonical token counts Artificial Analysis publishes for its Intelligence
 * Index benchmark: how many tokens a model actually spent on the benchmark.
 *
 * Invariant enforced by validation: output === answer + reasoning.
 * These counts drive benchmark workload cost estimates in the AA chart, so
 * they must round-trip exactly (no rounding, no defaults).
 */
export const canonicalIntelligenceIndexTokenCountSchema = z
  .object({
    input: finiteNumber,
    output: finiteNumber,
    answer: finiteNumber,
    reasoning: finiteNumber,
  })
  .refine((t) => t.output === t.answer + t.reasoning, {
    message: "canonicalIntelligenceIndexTokenCount.output must equal answer + reasoning",
    path: ["output"],
  });

export type CanonicalIntelligenceIndexTokenCount = z.infer<
  typeof canonicalIntelligenceIndexTokenCountSchema
>;

/**
 * One canonical Artificial Analysis model record.
 *
 * All prices are USD per 1M tokens as published by Artificial Analysis.
 * Numeric values are preserved exactly as upstream returns them.
 * Records missing any required field must be rejected (fail closed), never
 * patched with defaults.
 */
export const artificialAnalysisModelSchema = z
  .object({
    /** Stable upstream id for the model. */
    id: nonEmptyString,
    /** Stable slug, e.g. "claude-opus-5"; primary dedup key. */
    slug: nonEmptyString,
    name: nonEmptyString,
    shortName: nonEmptyString,
    /** Release date as ISO date string (YYYY-MM-DD) when published. */
    releaseDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date string (YYYY-MM-DD)"),
    price1mInputTokens: finiteNumber,
    price1mOutputTokens: finiteNumber,
    /** Listed cache-hit input price, USD per 1M tokens. */
    cacheHitPrice: finiteNumber,
    /**
     * Listed cache-write price, USD per 1M tokens.
     * Persisted for completeness only: cache-write token counts are not
     * published, so cost estimates must never consume this field.
     */
    cacheWritePrice: finiteNumber,
    intelligenceIndex: finiteNumber,
    /** Total cost Artificial Analysis reports for one Intelligence Index run. */
    intelligenceIndexCost: z.object({
      total: finiteNumber,
    }),
    canonicalIntelligenceIndexTokenCount: canonicalIntelligenceIndexTokenCountSchema,
  })
  .strict();

export type ArtificialAnalysisModel = z.infer<typeof artificialAnalysisModelSchema>;

/** Identity key used for deterministic dedup of AA models. */
export function aaModelIdentityKey(model: Pick<ArtificialAnalysisModel, "slug" | "id">): string {
  return model.slug || model.id;
}

/**
 * Validate a full AA model set: every record individually valid, no duplicate
 * identity keys, results sorted by slug for deterministic serialization.
 */
export function validateAaModelCollection(records: unknown): ArtificialAnalysisModel[] {
  if (!Array.isArray(records)) {
    throw new TypeError("AA model collection must be an array");
  }
  const seen = new Map<string, number>();
  const parsed = records.map((record, index) => {
    const result = artificialAnalysisModelSchema.safeParse(record);
    if (!result.success) {
      throw new Error(
        `Invalid Artificial Analysis model record at index ${index}: ${result.error.message}`,
      );
    }
    const key = aaModelIdentityKey(result.data);
    const firstAtIndex = seen.get(key);
    if (firstAtIndex !== undefined) {
      throw new Error(
        `Duplicate Artificial Analysis model identity "${key}" at indices ${firstAtIndex} and ${index}`,
      );
    }
    seen.set(key, index);
    return result.data;
  });
  return parsed.sort((a, b) => aaModelIdentityKey(a).localeCompare(aaModelIdentityKey(b)));
}

/** Source metadata stamped onto every AA snapshot. */
export const aaSourceMetadataSchema = z
  .object({
    source: z.literal("aa"),
    /** Model page the RSC discovery started from. */
    startUrl: z.string().url(),
    /** RSC endpoint the collector dynamically discovered for this run. */
    rscEndpoint: z.string().url(),
  })
  .strict();

export type AaSourceMetadata = z.infer<typeof aaSourceMetadataSchema>;

/** Full AA snapshot payload as persisted by the collector. */
export const aaSnapshotPayloadSchema = z.object({
  observedAt: isoUtcTimestamp,
  source: aaSourceMetadataSchema,
  records: z.array(artificialAnalysisModelSchema),
});

export type AaSnapshotPayload = z.infer<typeof aaSnapshotPayloadSchema>;
