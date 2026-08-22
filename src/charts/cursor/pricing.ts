import {
  CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS,
  type DerivedCursorChartRecord,
} from "../../schemas";

/**
 * Published Cursor model-rate assumptions used only for the optional estimate.
 * CursorBench publishes completion tokens per task, not total processed tokens;
 * hidden non-output volume is inferred from the published task cost and rates.
 * A model without an explicit profile is deliberately left unadjusted.
 *
 * Prices are USD per million tokens. Cache hit rate is a physical ratio of
 * cache-read tokens to all non-output prompt tokens, not a price-mix slider.
 */
export interface CursorTokenRateProfile {
  inputPriceUsdPerMillion: number;
  cacheReadPriceUsdPerMillion: number;
  cacheWritePriceUsdPerMillion?: number;
  outputPriceUsdPerMillion: number;
}

function profile(
  input: number,
  cacheRead: number,
  cacheWrite: number | undefined,
  output: number,
): CursorTokenRateProfile {
  return {
    inputPriceUsdPerMillion: input,
    cacheReadPriceUsdPerMillion: cacheRead,
    cacheWritePriceUsdPerMillion: cacheWrite,
    outputPriceUsdPerMillion: output,
  };
}

// Cursor's Luna card has distinct input, cache-read, and cache-write prices.
const LUNA_PROFILE = profile(0.2, 0.02, 0.25, 1.2);
const FABLE_5_PROFILE = profile(10, 1, 12.5, 50);

/**
 * Profiles are keyed by derived model id. These are the current rate-card
 * values used by the estimator; effort variants share their family profile.
 */
const PROFILE_BY_MODEL_ID: ReadonlyArray<readonly [RegExp, CursorTokenRateProfile]> = [
  [/^gpt-5-6-luna(?:-|$)/, LUNA_PROFILE],
  [/^gpt-5-6-sol(?:-|$)/, profile(4, 0.4, 5, 20)],
  [/^gpt-5-6-terra(?:-|$)/, profile(2, 0.2, 2.5, 12)],
  [/^opus-5(?:-|$)/, profile(5, 0.5, 6.25, 25)],
  [/^fable-5(?:-|$)/, FABLE_5_PROFILE],
  [/^sonnet-5(?:-|$)/, profile(2, 0.2, 2.5, 10)],
  [/^gemini-3-1-pro(?:-|$)/, profile(2, 0.2, undefined, 12)],
  [/^gemini-3-7-flash(?:-|$)/, profile(0.75, 0.075, undefined, 3.5)],
];

/** Cursor Models are first-party and do not incur the third-party fee. */
export function isCursorFirstPartyModel(modelId: string): boolean {
  return /^(?:grok-4-6|grok-4-5|composer-2-5)(?:-|$)/.test(modelId);
}

export function cursorTokenRateProfile(
  record: Pick<DerivedCursorChartRecord, "modelId">,
): CursorTokenRateProfile | null {
  for (const [pattern, rateProfile] of PROFILE_BY_MODEL_ID) {
    if (pattern.test(record.modelId)) return rateProfile;
  }
  return null;
}

/** Valid positive non-output rates published for a model. */
export function cursorNonOutputPrices(profile: CursorTokenRateProfile): number[] {
  return [
    profile.inputPriceUsdPerMillion,
    profile.cacheReadPriceUsdPerMillion,
    profile.cacheWritePriceUsdPerMillion,
  ].filter((price): price is number => price !== undefined && Number.isFinite(price) && price > 0);
}

/**
 * Blend the cache-read rate with the central non-cached rate at a physical
 * cache-hit percentage. When cache-write pricing exists, the non-cached
 * portion uses the midpoint of input and cache-write rates.
 */
export function blendCursorNonOutputPrice(
  profile: CursorTokenRateProfile,
  cacheHitRatePercent: number,
): number | null {
  if (
    !Number.isFinite(cacheHitRatePercent) ||
    cacheHitRatePercent < 0 ||
    cacheHitRatePercent > 100 ||
    !Number.isFinite(profile.inputPriceUsdPerMillion) ||
    profile.inputPriceUsdPerMillion <= 0 ||
    !Number.isFinite(profile.cacheReadPriceUsdPerMillion) ||
    profile.cacheReadPriceUsdPerMillion <= 0
  ) return null;
  const nonCachedRate = profile.cacheWritePriceUsdPerMillion === undefined
    ? profile.inputPriceUsdPerMillion
    : (profile.inputPriceUsdPerMillion + profile.cacheWritePriceUsdPerMillion) / 2;
  if (!Number.isFinite(nonCachedRate) || nonCachedRate <= 0) return null;
  const hitRate = cacheHitRatePercent / 100;
  const value = hitRate * profile.cacheReadPriceUsdPerMillion + (1 - hitRate) * nonCachedRate;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface CursorTokenRateEstimate {
  cacheHitRatePercent: number;
  blendedNonOutputPriceUsdPerMillion: number;
  nonCachedRateUsdPerMillion: number;
  hiddenTokens: number;
  totalTokens: number;
  completionTokens: number;
  outputCostUsd: number;
  residualNonOutputCostUsd: number;
  surchargeUsd: number;
  adjustedCostUsd: number;
  /** Lowest/highest surcharge using input/cache-write endpoints at this hit rate. */
  surchargeRangeUsd: readonly [number, number];
  adjustedCostRangeUsd: readonly [number, number];
}

/** CursorBench's `tokensPerTask` is the published completion/output count. */
export function cursorCompletionTokens(record: Pick<DerivedCursorChartRecord, "tokensPerTask" | "outputTokens">): number | null {
  const completionTokens = record.tokensPerTask ?? record.outputTokens;
  return completionTokens !== undefined && Number.isFinite(completionTokens) && completionTokens >= 0
    ? completionTokens
    : null;
}

function blendedRateAtNonCachedRate(
  profile: CursorTokenRateProfile,
  cacheHitRatePercent: number,
  nonCachedRate: number,
): number {
  const hitRate = cacheHitRatePercent / 100;
  return hitRate * profile.cacheReadPriceUsdPerMillion + (1 - hitRate) * nonCachedRate;
}

function totalTokensAtRate(residualCostUsd: number, completionTokens: number, rate: number): number {
  return (residualCostUsd / rate) * 1e6 + completionTokens;
}

/**
 * Estimate hidden and total tokens from published task cost using the selected
 * cache-read share. The estimate is unavailable for first-party Cursor models,
 * invalid residuals, or missing completion/rate data.
 */
export function estimateCursorTokenRate(
  record: DerivedCursorChartRecord,
  cacheHitRatePercent: number,
): CursorTokenRateEstimate | null {
  if (!record.isThirdParty || isCursorFirstPartyModel(record.modelId)) return null;
  const rateProfile = cursorTokenRateProfile(record);
  const completionTokens = cursorCompletionTokens(record);
  const publishedCost = record.publishedCostUsd;
  if (
    rateProfile === null ||
    completionTokens === null ||
    publishedCost === undefined ||
    !Number.isFinite(publishedCost) ||
    publishedCost <= 0 ||
    !Number.isFinite(rateProfile.outputPriceUsdPerMillion) ||
    rateProfile.outputPriceUsdPerMillion <= 0
  ) return null;

  const blended = blendCursorNonOutputPrice(rateProfile, cacheHitRatePercent);
  if (blended === null) return null;
  const nonCachedRate = rateProfile.cacheWritePriceUsdPerMillion === undefined
    ? rateProfile.inputPriceUsdPerMillion
    : (rateProfile.inputPriceUsdPerMillion + rateProfile.cacheWritePriceUsdPerMillion) / 2;
  const outputCostUsd = (completionTokens / 1e6) * rateProfile.outputPriceUsdPerMillion;
  const residualNonOutputCostUsd = publishedCost - outputCostUsd;
  if (!Number.isFinite(outputCostUsd) || !Number.isFinite(residualNonOutputCostUsd) || residualNonOutputCostUsd < 0) return null;

  const hiddenTokens = (residualNonOutputCostUsd / blended) * 1e6;
  const totalTokens = hiddenTokens + completionTokens;
  const nonCachedRates = [
    rateProfile.inputPriceUsdPerMillion,
    rateProfile.cacheWritePriceUsdPerMillion,
  ].filter((rate): rate is number => rate !== undefined && Number.isFinite(rate) && rate > 0);
  const lowNonCachedRate = Math.min(...nonCachedRates);
  const highNonCachedRate = Math.max(...nonCachedRates);
  const lowBlendedRate = blendedRateAtNonCachedRate(rateProfile, cacheHitRatePercent, lowNonCachedRate);
  const highBlendedRate = blendedRateAtNonCachedRate(rateProfile, cacheHitRatePercent, highNonCachedRate);
  const minTotalTokens = totalTokensAtRate(residualNonOutputCostUsd, completionTokens, highBlendedRate);
  const maxTotalTokens = totalTokensAtRate(residualNonOutputCostUsd, completionTokens, lowBlendedRate);
  if (
    !Number.isFinite(hiddenTokens) || !Number.isFinite(totalTokens) || hiddenTokens < 0 ||
    !Number.isFinite(minTotalTokens) || !Number.isFinite(maxTotalTokens)
  ) return null;

  const surchargeUsd = (totalTokens / 1e6) * CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS;
  const minSurchargeUsd = (minTotalTokens / 1e6) * CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS;
  const maxSurchargeUsd = (maxTotalTokens / 1e6) * CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS;
  if (![surchargeUsd, minSurchargeUsd, maxSurchargeUsd].every(Number.isFinite)) return null;

  return {
    cacheHitRatePercent,
    blendedNonOutputPriceUsdPerMillion: blended,
    nonCachedRateUsdPerMillion: nonCachedRate,
    hiddenTokens,
    totalTokens,
    completionTokens,
    outputCostUsd,
    residualNonOutputCostUsd,
    surchargeUsd,
    adjustedCostUsd: publishedCost + surchargeUsd,
    surchargeRangeUsd: [minSurchargeUsd, maxSurchargeUsd],
    adjustedCostRangeUsd: [publishedCost + minSurchargeUsd, publishedCost + maxSurchargeUsd],
  };
}
