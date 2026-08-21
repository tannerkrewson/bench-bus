import type { ArtificialAnalysisModel } from "../aa";

/**
 * Representative VALID Artificial Analysis canonical model record.
 * Numbers chosen so output === answer + reasoning holds exactly.
 */
export const validAaModel: ArtificialAnalysisModel = {
  id: "anthropic/claude-opus-5",
  slug: "claude-opus-5",
  name: "Claude Opus 5",
  shortName: "Opus 5",
  releaseDate: "2026-05-12",
  price1mInputTokens: 5,
  price1mOutputTokens: 25,
  cacheHitPrice: 0.5,
  cacheWritePrice: 6.25,
  intelligenceIndex: 42.7,
  intelligenceIndexCost: { total: 12.34 },
  canonicalIntelligenceIndexTokenCount: {
    input: 150_000,
    output: 45_000,
    answer: 30_000,
    reasoning: 15_000,
  },
};

/** Second valid record with a different slug, for collection-level tests. */
export const validAaModel2: ArtificialAnalysisModel = {
  id: "openai/gpt-6",
  slug: "gpt-6",
  name: "GPT-6",
  shortName: "GPT-6",
  releaseDate: "2026-06-01",
  price1mInputTokens: 2.5,
  price1mOutputTokens: 10,
  cacheHitPrice: 0.25,
  cacheWritePrice: 3.125,
  intelligenceIndex: 39.1,
  intelligenceIndexCost: { total: 9.87 },
  canonicalIntelligenceIndexTokenCount: {
    input: 120_000,
    output: 50_000.5,
    answer: 30_000.25,
    reasoning: 20_000.25,
  },
};

/** Invalid: output does not equal answer + reasoning. */
export const invalidAaModelTokenMismatch: Record<string, unknown> = {
  ...validAaModel,
  slug: "token-mismatch-model",
  canonicalIntelligenceIndexTokenCount: {
    input: 150_000,
    output: 99_999,
    answer: 30_000,
    reasoning: 15_000,
  },
};

/** Invalid: missing required pricing field (incomplete record). */
export const invalidAaModelMissingField: Record<string, unknown> = (() => {
  const { cacheHitPrice, ...rest } = validAaModel;
  return { ...rest, slug: "missing-cache-hit-price" };
})();

/** Invalid: non-finite numeric value. */
export const invalidAaModelNonFinite: Record<string, unknown> = {
  ...validAaModel,
  slug: "non-finite-price",
  price1mInputTokens: Number.POSITIVE_INFINITY,
};
