import type {
  CursorEvalRecord,
  OpenRouterModelPricing,
} from "../index";

/** Representative VALID OpenRouter pricing record for one mapped model. */
export const validOpenRouterPricing: OpenRouterModelPricing = {
  permaslug: "anthropic/claude-opus-5",
  aaModelSlug: "claude-opus-5",
  aaModelId: "anthropic/claude-opus-5",
  weightedInputPrice: 4.75,
  weightedOutputPrice: 23.5,
  providerSummaries: [
    {
      providerName: "Anthropic",
      providerSlug: "anthropic",
      effectiveInputPrice: 5,
      effectiveOutputPrice: 25,
    },
    {
      providerName: "Chutes",
      providerSlug: "chutes",
      effectiveInputPrice: 1.2,
      effectiveOutputPrice: 18,
    },
  ],
};

/** Invalid: empty providerSummaries array (min 1). */
export const invalidOpenRouterNoProviders: Record<string, unknown> = {
  ...validOpenRouterPricing,
  providerSummaries: [],
};

/** Invalid: duplicate aaModelSlug across records. */
export const validOpenRouterPricing2: OpenRouterModelPricing = {
  permaslug: "openai/gpt-6",
  aaModelSlug: "gpt-6",
  aaModelId: "openai/gpt-6",
  weightedInputPrice: 2,
  weightedOutputPrice: 8,
  providerSummaries: [
    {
      providerName: "OpenAI",
      providerSlug: "openai",
      effectiveInputPrice: 2.5,
      effectiveOutputPrice: 10,
    },
  ],
};

/** Representative VALID Cursor eval record (first-party). */
export const validCursorRecord: CursorEvalRecord = {
  modelId: "composer-2",
  modelName: "Composer 2",
  provider: "cursor",
  isThirdParty: false,
  score: 68.4,
  inputTokens: 82_000,
  outputTokens: 12_500,
};

/** Second valid Cursor record (third-party, for surcharge-flag tests). */
export const validCursorRecord2: CursorEvalRecord = {
  modelId: "gpt-6",
  modelName: "GPT-6",
  provider: "openai",
  isThirdParty: true,
  score: 71.2,
  inputTokens: 95_000,
  outputTokens: 20_000,
  publishedCostUsd: 1.85,
  tokensPerTask: 115_000,
  stepsPerTask: 46,
};

/** Invalid: Cursor score outside [0, 100]. */
export const invalidCursorScoreOutOfRange: Record<string, unknown> = {
  ...validCursorRecord,
  modelId: "bad-score",
  score: 142,
};

/** Invalid: missing provider (incomplete record). */
export const invalidCursorMissingProvider: Record<string, unknown> = (() => {
  const { provider, ...rest } = validCursorRecord;
  return { ...rest, modelId: "missing-provider" };
})();
