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
 * Pricing references:
 * - https://cursor.com/docs/models-and-pricing
 * - https://prod.cursor.com/docs/models/gpt-5-6-luna
 */
export interface CursorTokenRateProfile {
  /** Published input-priced endpoint, USD per million non-output tokens. */
  inputPriceUsdPerMillion: number;
  /** Published cache-read endpoint, USD per million non-output tokens. */
  cacheReadPriceUsdPerMillion: number;
  /** Published cache-write endpoint, when the model's rate card includes one. */
  cacheWritePriceUsdPerMillion?: number;
  /** Published output rate, USD per million completion tokens. */
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

/**
 * Profiles are keyed by the derived model id, not display text. Values mirror
 * the published Cursor model table; effort variants use their model-family
 * rate card. Composer is intentionally absent because it is first-party and
 * exempt from this fee.
 */
const PROFILE_BY_MODEL_ID: ReadonlyArray<readonly [RegExp, CursorTokenRateProfile]> = [
  [/^gpt-5-6-luna(?:-|$)/, LUNA_PROFILE],
  [/^gpt-5-6-sol(?:-|$)/, profile(5, 0.5, undefined, 30)],
  [/^gpt-5-6-terra(?:-|$)/, profile(2, 0.2, undefined, 12)],
  [/^grok-4-6(?:-|$)/, profile(2, 0.5, undefined, 6)],
  [/^grok-4-5(?:-|$)/, profile(2, 0.5, undefined, 6)],
  [/^opus-5(?:-|$)/, profile(5, 0.5, undefined, 25)],
  [/^sonnet-5(?:-|$)/, profile(2, 0.2, undefined, 10)],
  [/^gemini-3-1-pro(?:-|$)/, profile(2, 0.2, undefined, 12)],
  [/^gemini-3-7-flash(?:-|$)/, profile(0.75, 0.075, undefined, 3.5)],
];

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
 * Logarithmically blend the cheapest/cache-heavy and most expensive
 * input/write-heavy non-output rates. This is a neutral mix assumption, not a
 * measured cache-hit percentage: 0% is pMin, 50% is the geometric midpoint,
 * and 100% is pMax.
 */
export function blendCursorNonOutputPrice(
  profile: CursorTokenRateProfile,
  tokenMixPercent: number,
): number | null {
  const prices = cursorNonOutputPrices(profile);
  if (
    prices.length === 0 ||
    !Number.isFinite(tokenMixPercent) ||
    tokenMixPercent < 0 ||
    tokenMixPercent > 100
  ) {
    return null;
  }
  const pMin = Math.min(...prices);
  const pMax = Math.max(...prices);
  const s = tokenMixPercent / 100;
  const value = pMin * (pMax / pMin) ** s;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface CursorTokenRateEstimate {
  blendedNonOutputPriceUsdPerMillion: number;
  /** Hidden non-output tokens inferred from residual cost. */
  hiddenTokens: number;
  /** Completion tokens plus inferred hidden non-output tokens. */
  totalTokens: number;
  completionTokens: number;
  outputCostUsd: number;
  residualNonOutputCostUsd: number;
  surchargeUsd: number;
  adjustedCostUsd: number;
  /** Lowest/highest surcharge across all valid published non-output rates. */
  surchargeRangeUsd: readonly [number, number];
  /** Lowest/highest adjusted cost across all valid published non-output rates. */
  adjustedCostRangeUsd: readonly [number, number];
}

/** CursorBench's `tokensPerTask` is the published completion/output count. */
export function cursorCompletionTokens(record: Pick<DerivedCursorChartRecord, "tokensPerTask" | "outputTokens">): number | null {
  const completionTokens = record.tokensPerTask ?? record.outputTokens;
  return completionTokens !== undefined && Number.isFinite(completionTokens) && completionTokens >= 0
    ? completionTokens
    : null;
}

/**
 * Estimate hidden and total tokens from published task cost. The estimate is
 * unavailable unless completion tokens, output pricing, and at least one
 * valid non-output rate are all known. In particular, completion tokens are
 * never treated as total tokens or used as a fee-only fallback.
 */
export function estimateCursorTokenRate(
  record: DerivedCursorChartRecord,
  tokenMixPercent: number,
): CursorTokenRateEstimate | null {
  if (!record.isThirdParty) return null;
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
  ) {
    return null;
  }

  const nonOutputPrices = cursorNonOutputPrices(rateProfile);
  if (nonOutputPrices.length === 0) return null;
  const outputCostUsd = (completionTokens / 1e6) * rateProfile.outputPriceUsdPerMillion;
  const residualNonOutputCostUsd = publishedCost - outputCostUsd;
  // A published output cost above the total benchmark cost is inconsistent;
  // do not turn the negative residual into a completion-only surcharge.
  if (
    !Number.isFinite(outputCostUsd) ||
    !Number.isFinite(residualNonOutputCostUsd) ||
    residualNonOutputCostUsd < 0
  ) {
    return null;
  }

  const blended = blendCursorNonOutputPrice(rateProfile, tokenMixPercent);
  if (blended === null) return null;

  const hiddenTokens = (residualNonOutputCostUsd / blended) * 1e6;
  const totalTokens = hiddenTokens + completionTokens;
  const pMin = Math.min(...nonOutputPrices);
  const pMax = Math.max(...nonOutputPrices);
  const minTotalTokens = totalTokensAtPrice(residualNonOutputCostUsd, completionTokens, pMax);
  const maxTotalTokens = totalTokensAtPrice(residualNonOutputCostUsd, completionTokens, pMin);
  if (
    !Number.isFinite(hiddenTokens) ||
    !Number.isFinite(totalTokens) ||
    !Number.isFinite(minTotalTokens) ||
    !Number.isFinite(maxTotalTokens) ||
    hiddenTokens < 0
  ) {
    return null;
  }

  const surchargeUsd = (totalTokens / 1e6) * CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS;
  const minSurchargeUsd = (minTotalTokens / 1e6) * CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS;
  const maxSurchargeUsd = (maxTotalTokens / 1e6) * CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS;
  if (![surchargeUsd, minSurchargeUsd, maxSurchargeUsd].every(Number.isFinite)) return null;

  return {
    blendedNonOutputPriceUsdPerMillion: blended,
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

function totalTokensAtPrice(residualCostUsd: number, completionTokens: number, price: number): number {
  return (residualCostUsd / price) * 1e6 + completionTokens;
}
