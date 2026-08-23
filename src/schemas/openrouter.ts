import { z } from "zod";
import { finiteNumber, isoUtcTimestamp, nonEmptyString } from "./primitives";

/**
 * One OpenRouter provider's effective pricing for a model, as returned in
 * `data.providerSummaries` of the effective-pricing endpoint.
 */
export const openRouterProviderSummarySchema = z
  .object({
    providerName: nonEmptyString,
    providerSlug: nonEmptyString,
    /** Effective input price, USD per 1M tokens, after OpenRouter routing. */
    effectiveInputPrice: finiteNumber,
    /** Effective output price, USD per 1M tokens, after OpenRouter routing. */
    effectiveOutputPrice: finiteNumber,
    /** Optional listed prices when the effective endpoint supplies them for this provider. */
    listedInputPrice: finiteNumber.optional(),
    listedOutputPrice: finiteNumber.optional(),
    /** Explicit source-provided discount percentage; never computed from price ratios. */
    discountPercentage: finiteNumber.refine((value) => value >= 0 && value <= 100, {
      message: "discountPercentage must be between 0 and 100",
    }).optional(),
    /** Explicit cross-model relation for a discounted OpenRouter model tier. */
    undiscountedModelId: nonEmptyString.optional(),
  })
  .strict();

export type OpenRouterProviderSummary = z.infer<typeof openRouterProviderSummarySchema>;

/**
 * OpenRouter effective-pricing snapshot for ONE Artificial Analysis model.
 *
 * `permaslug` is the OpenRouter identity; `aaModelSlug`/`aaModelId` carry the
 * explicit, version-controlled mapping back to Artificial Analysis. Ambiguous
 * mappings must be resolved in the mapping file by the collector before a
 * snapshot is produced — never guessed at validation time.
 */
export const openRouterModelPricingSchema = z
  .object({
    /** OpenRouter permaslug, e.g. "anthropic/claude-opus-5". */
    permaslug: nonEmptyString,
    /** Artificial Analysis slug this pricing row is mapped to. */
    aaModelSlug: nonEmptyString,
    /** Artificial Analysis id this pricing row is mapped to (redundant link). */
    aaModelId: nonEmptyString,
    /** Model-wide weighted effective prices from the endpoint top level. */
    weightedInputPrice: finiteNumber,
    weightedOutputPrice: finiteNumber,
    /** Per-provider effective prices, preserved as returned, plus explicit discount metadata. */
    providerSummaries: z.array(openRouterProviderSummarySchema).min(1),
    /** Listed model prices from the catalog, USD per 1M tokens, when published. */
    listedInputPrice: finiteNumber.optional(),
    listedOutputPrice: finiteNumber.optional(),
    listedCacheReadPrice: finiteNumber.optional(),
    listedCacheWritePrice: finiteNumber.optional(),
  })
  .strict();

export type OpenRouterModelPricing = z.infer<typeof openRouterModelPricingSchema>;

/** Source metadata stamped onto every OpenRouter snapshot. */
export const openRouterSourceMetadataSchema = z
  .object({
    source: z.literal("openrouter"),
    /** Exact endpoint template queried; permaslug is appended per model. */
    endpointUrl: z.string().url(),
    /** Mapping file commit/identifier used for AA -> OpenRouter linkage. */
    mappingRef: nonEmptyString,
  })
  .strict();

export type OpenRouterSourceMetadata = z.infer<typeof openRouterSourceMetadataSchema>;

/** Full OpenRouter snapshot payload as persisted by the collector. */
export const openRouterSnapshotPayloadSchema = z
  .object({
    observedAt: isoUtcTimestamp,
    source: openRouterSourceMetadataSchema,
    records: z.array(openRouterModelPricingSchema),
  })
  .refine(
    (payload) => {
      const keys = payload.records.map((r) => r.aaModelSlug);
      return new Set(keys).size === keys.length;
    },
    { message: "duplicate aaModelSlug entries in OpenRouter snapshot" },
  );

export type OpenRouterSnapshotPayload = z.infer<typeof openRouterSnapshotPayloadSchema>;
