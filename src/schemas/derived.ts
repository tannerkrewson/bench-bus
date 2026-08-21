import { z } from "zod";
import { finiteNumber, isoUtcTimestamp, nonEmptyString } from "./primitives";
import { SCHEMA_VERSIONS } from "./version";
import { openRouterProviderSummarySchema } from "./openrouter";


/**
 * Derived chart records are the compact, browser-facing contracts compiled at
 * build time from validated snapshots. They carry exactly what the charts
 * need — including enough provider data to recompute cheapest-single-provider
 * cost for the actual benchmark token workload — plus freshness metadata.
 */

/** AA listed-pricing inputs for the cache-hit-rate estimate. */
export const listedPricingInputsSchema = z
  .object({
    price1mInputTokens: finiteNumber,
    price1mOutputTokens: finiteNumber,
    cacheHitPrice: finiteNumber,
  })
  .strict();

export type ListedPricingInputs = z.infer<typeof listedPricingInputsSchema>;

/**
 * Matched AA + OpenRouter chart record for one model.
 *
 * `canonicalTokens` are the actual Intelligence Index workload counts used by
 * every pricing mode; no normalized or hypothetical workload exists.
 */
export const derivedAaChartRecordSchema = z
  .object({
    slug: nonEmptyString,
    name: nonEmptyString,
    shortName: nonEmptyString,
    intelligenceIndex: finiteNumber,
    canonicalTokens: z
      .object({
        input: finiteNumber,
        output: finiteNumber,
      })
      .strict(),
    /**
     * Cheapest-single-provider mode: every provider's effective prices.
     * An empty array means no OpenRouter pricing was known for this model at
     * the compiled point in time — the record is unplottable in cost terms and
     * charts must surface it as such rather than mispricing it.
     */
    providers: z.array(openRouterProviderSummarySchema),
    /** Weighted OpenRouter mode: model-wide weighted effective prices. */
    weighted: z
      .object({
        weightedInputPrice: finiteNumber,
        weightedOutputPrice: finiteNumber,
      })
      .strict(),
    /** AA listed-pricing mode inputs (cache-hit slider applied downstream). */
    listed: listedPricingInputsSchema,
  })
  .strict();

export type DerivedAaChartRecord = z.infer<typeof derivedAaChartRecordSchema>;

/**
 * Matched Cursor chart record. Raw table fields plus the surcharge flag;
 * surcharge math happens in the chart's cost calculator, never here.
 */
export const derivedCursorChartRecordSchema = z
  .object({
    modelId: nonEmptyString,
    modelName: nonEmptyString,
    provider: nonEmptyString,
    isThirdParty: z.boolean(),
    score: finiteNumber,
    inputTokens: finiteNumber.optional(),
    outputTokens: finiteNumber.optional(),
    publishedCostUsd: finiteNumber.optional(),
    /**
     * Published CursorBench completion/output tokens per task (not total
     * processed tokens). Hidden non-output volume is estimated separately.
     */
    tokensPerTask: finiteNumber.optional(),
  })
  .strict();

export type DerivedCursorChartRecord = z.infer<typeof derivedCursorChartRecordSchema>;

/**
 * Freshness metadata for a compiled derived dataset. Each source resolves
 * independently to its latest snapshot at or before the requested time, so
 * the three timestamps legitimately differ.
 */
export const freshnessMetadataSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.derived),
    /** The point in time the dataset was compiled for. */
    asOf: isoUtcTimestamp,
    /** Observation time of the AA snapshot used. Absent = no AA snapshot at/before asOf. */
    aaObservedAt: isoUtcTimestamp.optional(),
    /** Observation time of the OpenRouter snapshot used. Absent = no pricing available. */
    openrouterObservedAt: isoUtcTimestamp.optional(),
    /** Observation time of the Cursor snapshot used. Absent = no Cursor snapshot at/before asOf. */
    cursorObservedAt: isoUtcTimestamp.optional(),
  })
  .strict();

export type FreshnessMetadata = z.infer<typeof freshnessMetadataSchema>;

/** Top-level derived dataset shipped to the browser for the AA chart. */
export const derivedAaDatasetSchema = z.object({
  freshness: freshnessMetadataSchema,
  records: z.array(derivedAaChartRecordSchema),
});

export type DerivedAaDataset = z.infer<typeof derivedAaDatasetSchema>;

/** Top-level derived dataset shipped to the browser for the Cursor chart. */
export const derivedCursorDatasetSchema = z.object({
  freshness: freshnessMetadataSchema,
  records: z.array(derivedCursorChartRecordSchema),
});

export type DerivedCursorDataset = z.infer<typeof derivedCursorDatasetSchema>;

/**
 * Cursor third-party-model surcharge, USD per 1M tokens. Exported as a named
 * constant so the chart UI, calculators, and tests share one value.
 */
export const CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS = 0.25;
