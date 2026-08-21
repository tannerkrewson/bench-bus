import {
  CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS,
  type DerivedCursorChartRecord,
} from "../../schemas";

/**
 * Published Cursor model-rate assumptions used only for the optional estimate.
 * CursorBench's raw rows do not include input/output splits or rate cards, so a
 * model without an explicit profile is deliberately left unadjusted.
 *
 * Cursor pricing references:
 * - https://cursor.com/docs/models-and-pricing
 * - https://prod.cursor.com/docs/models/gpt-5-6-luna
 */
export interface CursorTokenRateProfile {
  /** Cache-priced endpoint, USD per million non-output tokens. */
  nonOutputPriceMinUsdPerMillion: number;
  /** Input-priced endpoint, USD per million non-output tokens. */
  nonOutputPriceMaxUsdPerMillion: number;
  /** Published output rate, USD per million output tokens. */
  outputPriceUsdPerMillion: number;
}

function profile(
  input: number,
  cacheRead: number,
  output: number,
): CursorTokenRateProfile {
  return {
    nonOutputPriceMinUsdPerMillion: cacheRead,
    nonOutputPriceMaxUsdPerMillion: input,
    outputPriceUsdPerMillion: output,
  };
}

const LUNA_PROFILE = profile(0.25, 0.02, 1.2);

/**
 * Profiles are keyed by the derived model id, not display text. Values mirror
 * the published Cursor model table; effort variants use their model-family
 * rate card. Composer is intentionally absent because it is first-party and
 * exempt from this fee.
 */
const PROFILE_BY_MODEL_ID: ReadonlyArray<readonly [RegExp, CursorTokenRateProfile]> = [
  [/^gpt-5-6-luna(?:-|$)/, LUNA_PROFILE],
  [/^gpt-5-6-sol(?:-|$)/, profile(5, 0.5, 30)],
  [/^gpt-5-6-terra(?:-|$)/, profile(2, 0.2, 12)],
  [/^grok-4-6(?:-|$)/, profile(2, 0.5, 6)],
  [/^grok-4-5(?:-|$)/, profile(2, 0.5, 6)],
  [/^opus-5(?:-|$)/, profile(5, 0.5, 25)],
  [/^sonnet-5(?:-|$)/, profile(2, 0.2, 10)],
  [/^gemini-3-1-pro(?:-|$)/, profile(2, 0.2, 12)],
  [/^gemini-3-7-flash(?:-|$)/, profile(0.75, 0.075, 3.5)],
];

export function cursorTokenRateProfile(
  record: Pick<DerivedCursorChartRecord, "modelId">,
): CursorTokenRateProfile | null {
  for (const [pattern, profile] of PROFILE_BY_MODEL_ID) {
    if (pattern.test(record.modelId)) return profile;
  }
  return null;
}

/**
 * Logarithmically blend the input-priced and cache-priced non-output rates.
 * `cacheHitRatePercent` is the standard cached-input/total-input percentage:
 * 0 is fully input-priced and 100 is fully cache-priced.
 */
export function blendCursorNonOutputPrice(
  profile: CursorTokenRateProfile,
  cacheHitRatePercent: number,
): number | null {
  const min = profile.nonOutputPriceMinUsdPerMillion;
  const max = profile.nonOutputPriceMaxUsdPerMillion;
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min <= 0 ||
    max <= 0 ||
    max < min ||
    !Number.isFinite(cacheHitRatePercent) ||
    cacheHitRatePercent < 0 ||
    cacheHitRatePercent > 100
  ) {
    return null;
  }
  const cacheHitRate = cacheHitRatePercent / 100;
  // At 0% all input is charged at the input rate; at 100% all is cached.
  const value = max * (min / max) ** cacheHitRate;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface CursorTokenRateEstimate {
  blendedNonOutputPriceUsdPerMillion: number;
  hiddenTokens: number;
  totalTokens: number;
  outputCostUsd: number;
  surchargeUsd: number;
  adjustedCostUsd: number;
  /** Lowest/highest surcharge across the two published non-output endpoints. */
  surchargeRangeUsd: readonly [number, number];
  /** Lowest/highest adjusted cost across the two published endpoints. */
  adjustedCostRangeUsd: readonly [number, number];
}

/**
 * Estimate hidden and total tokens from the published task cost. No estimate
 * is returned when the raw record lacks output tokens, has invalid numbers, or
 * leaves a negative residual after known output cost is removed.
 */
export function estimateCursorTokenRate(
  record: DerivedCursorChartRecord,
  cacheHitRatePercent: number,
): CursorTokenRateEstimate | null {
  if (!record.isThirdParty) return null;
  const profile = cursorTokenRateProfile(record);
  const outputTokens = record.outputTokens;
  const publishedCost = record.publishedCostUsd;
  if (
    profile === null ||
    outputTokens === undefined ||
    publishedCost === undefined ||
    !Number.isFinite(outputTokens) ||
    !Number.isFinite(publishedCost) ||
    outputTokens < 0 ||
    publishedCost <= 0 ||
    !Number.isFinite(profile.outputPriceUsdPerMillion) ||
    profile.outputPriceUsdPerMillion < 0
  ) {
    return null;
  }

  const outputCostUsd = (outputTokens / 1e6) * profile.outputPriceUsdPerMillion;
  const residualUsd = publishedCost - outputCostUsd;
  if (!Number.isFinite(outputCostUsd) || !Number.isFinite(residualUsd) || residualUsd < 0) {
    return null;
  }

  const blended = blendCursorNonOutputPrice(profile, cacheHitRatePercent);
  // The lowest fee comes from the cache-priced endpoint; the highest from
  // the input-priced endpoint.
  const cachePrice = blendCursorNonOutputPrice(profile, 100);
  const inputPrice = blendCursorNonOutputPrice(profile, 0);
  if (blended === null || cachePrice === null || inputPrice === null) return null;

  const hiddenTokens = (residualUsd / blended) * 1e6;
  const totalTokens = hiddenTokens + outputTokens;
  if (!Number.isFinite(hiddenTokens) || !Number.isFinite(totalTokens) || hiddenTokens < 0) {
    return null;
  }

  const surchargeUsd = (totalTokens / 1e6) * CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS;
  const minSurchargeUsd =
    (totalTokensAtPrice(residualUsd, outputTokens, cachePrice) / 1e6) *
    CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS;
  const maxSurchargeUsd =
    (totalTokensAtPrice(residualUsd, outputTokens, inputPrice) / 1e6) *
    CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS;
  if (![surchargeUsd, minSurchargeUsd, maxSurchargeUsd].every(Number.isFinite)) return null;

  return {
    blendedNonOutputPriceUsdPerMillion: blended,
    hiddenTokens,
    totalTokens,
    outputCostUsd,
    surchargeUsd,
    adjustedCostUsd: publishedCost + surchargeUsd,
    surchargeRangeUsd: [minSurchargeUsd, maxSurchargeUsd],
    adjustedCostRangeUsd: [publishedCost + minSurchargeUsd, publishedCost + maxSurchargeUsd],
  };
}

function totalTokensAtPrice(residualUsd: number, outputTokens: number, price: number): number {
  return (residualUsd / price) * 1e6 + outputTokens;
}
