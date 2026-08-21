import {
  type DerivedAaChartRecord,
} from "../../schemas";
import {
  encodeAaDataset,
  encodeSourceAvailability,
  type CompactBundle,
} from "../../derived/encode";
import { SCHEMA_VERSIONS } from "../../schemas";

/**
 * Artificial Analysis chart fixtures. Schema-valid DerivedAaChartRecord
 * shapes used by pricing, adapter, and section tests, plus a compact bundle
 * fixture that round-trips through the real decode path (decodeBundle).
 */

export const AA_RECORD_PLOTTABLE_CHEAPEST: DerivedAaChartRecord = {
  slug: "claude-opus-5",
  name: "Claude Opus 5",
  shortName: "Opus 5",
  intelligenceIndex: 71.2,
  canonicalTokens: { input: 810_078_135, output: 114_542_834 },
  providers: [
    {
      providerName: "Azure (US)",
      providerSlug: "azure-us",
      effectiveInputPrice: 2.5,
      effectiveOutputPrice: 12.5,
    },
    {
      providerName: "Bedrock",
      providerSlug: "bedrock",
      effectiveInputPrice: 2.2,
      effectiveOutputPrice: 13.9,
    },
  ],
  weighted: { weightedInputPrice: 2.4, weightedOutputPrice: 13.0 },
  listed: { price1mInputTokens: 2.5, price1mOutputTokens: 12.5, cacheHitPrice: 0.3 },
};

/** Provider that is pricier on input but cheaper on output than Bedrock. */
export const AA_RECORD_CROSS_PROVIDER: DerivedAaChartRecord = {
  slug: "gpt-5.6-sol",
  name: "GPT-5.6 Sol",
  shortName: "GPT-5.6",
  intelligenceIndex: 74.8,
  canonicalTokens: { input: 100_000_000, output: 900_000_000 },
  providers: [
    {
      providerName: "InputCheap",
      providerSlug: "input-cheap",
      effectiveInputPrice: 1.0,
      effectiveOutputPrice: 20.0,
    },
    {
      providerName: "OutputCheap",
      providerSlug: "output-cheap",
      effectiveInputPrice: 3.0,
      effectiveOutputPrice: 5.0,
    },
  ],
  weighted: { weightedInputPrice: 2.0, weightedOutputPrice: 11.0 },
  listed: { price1mInputTokens: 3.0, price1mOutputTokens: 10.0, cacheHitPrice: 0.3 },
};

export const AA_RECORD_NO_LISTING: DerivedAaChartRecord = {
  slug: "gemini-3.7-flash",
  name: "Gemini 3.7 Flash",
  shortName: "Gemini 3.7F",
  intelligenceIndex: 62.4,
  canonicalTokens: { input: 402_881_440, output: 61_003_988 },
  providers: [
    {
      providerName: "AI Studio",
      providerSlug: "ai-studio",
      effectiveInputPrice: 0.35,
      effectiveOutputPrice: 1.9,
    },
  ],
  weighted: { weightedInputPrice: 0.37, weightedOutputPrice: 1.95 },
  // All-zero listing = no listed pricing published.
  listed: { price1mInputTokens: 0, price1mOutputTokens: 0, cacheHitPrice: 0 },
};

/** Unplottable: no provider pricing known at the compiled point in time. */
export const AA_RECORD_UNPLOTTABLE: DerivedAaChartRecord = {
  slug: "mystery-model",
  name: "Mystery Model",
  shortName: "Mystery",
  intelligenceIndex: 40.1,
  canonicalTokens: { input: 100_000_000, output: 10_000_000 },
  providers: [],
  weighted: { weightedInputPrice: 0, weightedOutputPrice: 0 },
  listed: { price1mInputTokens: 0, price1mOutputTokens: 0, cacheHitPrice: 0 },
};

export const AA_FIXTURE_RECORDS: readonly DerivedAaChartRecord[] = [
  AA_RECORD_PLOTTABLE_CHEAPEST,
  AA_RECORD_CROSS_PROVIDER,
  AA_RECORD_NO_LISTING,
  AA_RECORD_UNPLOTTABLE,
];

export const BUNDLE_AS_OF = "2026-08-21T00:00:00.000Z";

/**
 * Compact bundle fixture in the real wire format. Built with the production
 * encoder so tests exercise the actual decode path (decodeBundle).
 */
export function makeAaBundleFixture(): CompactBundle {
  const freshness = {
    schemaVersion: SCHEMA_VERSIONS.derived,
    asOf: BUNDLE_AS_OF,
    aaObservedAt: BUNDLE_AS_OF,
    openrouterObservedAt: BUNDLE_AS_OF,
    cursorObservedAt: BUNDLE_AS_OF,
  };
  const aa = encodeAaDataset({ freshness, records: [...AA_FIXTURE_RECORDS] });
  if (!aa) throw new Error("fixture encode failed");
  return {
    v: SCHEMA_VERSIONS.derived,
    asOf: BUNDLE_AS_OF,
    sources: {
      aa: encodeSourceAvailability({ available: true, observedAt: BUNDLE_AS_OF }),
      openrouter: encodeSourceAvailability({ available: true, observedAt: BUNDLE_AS_OF }),
      cursor: 0,
    },
    aa,
    cursor: null,
  };
}
