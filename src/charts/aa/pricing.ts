import type { DerivedAaChartRecord } from "../../schemas";

/**
 * Artificial Analysis chart pricing calculators.
 *
 * All modes estimate the cost of the model's ACTUAL canonical Intelligence
 * Index benchmark workload (canonicalTokens.input/output). There is
 * deliberately no normalized or hypothetical workload mode.
 */

/** Default share of input tokens assumed served from cache (listed mode). */
export const AA_DEFAULT_CACHE_HIT_RATE = 0.9;

/** One OpenRouter provider's effective prices, as preserved in derived records. */
export interface ProviderPrices {
  providerName: string;
  providerSlug: string;
  effectiveInputPrice: number;
  effectiveOutputPrice: number;
}

/** Winning provider of the cheapest-effective selection, with its combined cost. */
export interface CheapestProvider extends ProviderPrices {
  /** Combined input+output cost for the canonical workload, USD. */
  totalCostUsd: number;
}

function usablePrice(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Cheapest-effective mode: pick ONE real provider minimizing
 *   inputTokens/1e6 * effectiveInputPrice + outputTokens/1e6 * effectiveOutputPrice
 *
 * Providers are never mixed: the winner is a single provider chosen by the
 * combined benchmark workload cost, so a provider that is not independently
 * cheapest on both dimensions can (and should) win. Rare/low-volume providers
 * are never excluded. Ties break deterministically by providerSlug then
 * providerName. Returns null when there is no usable provider.
 */
export function selectCheapestProvider(
  providers: readonly ProviderPrices[],
  inputTokens: number,
  outputTokens: number,
): CheapestProvider | null {
  let best: CheapestProvider | null = null;
  for (const p of providers) {
    if (!usablePrice(p.effectiveInputPrice) || !usablePrice(p.effectiveOutputPrice)) continue;
    const totalCostUsd =
      (inputTokens / 1e6) * p.effectiveInputPrice + (outputTokens / 1e6) * p.effectiveOutputPrice;
    if (!Number.isFinite(totalCostUsd)) continue;
    if (
      best === null ||
      totalCostUsd < best.totalCostUsd ||
      (totalCostUsd === best.totalCostUsd &&
        (p.providerSlug < best.providerSlug ||
          (p.providerSlug === best.providerSlug && p.providerName < best.providerName)))
    ) {
      best = { ...p, totalCostUsd };
    }
  }
  return best;
}

/**
 * OpenRouter weighted mode: model-wide weighted effective prices applied to
 * the canonical workload. Returns null when both weighted prices are zero
 * (the empty-skeleton "no pricing data" case), never a fabricated zero cost.
 */
export function weightedCostUsd(
  weighted: Readonly<Pick<DerivedAaChartRecord["weighted"], "weightedInputPrice" | "weightedOutputPrice">>,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const { weightedInputPrice, weightedOutputPrice } = weighted;
  if (!usablePrice(weightedInputPrice) || !usablePrice(weightedOutputPrice)) return null;
  if (weightedInputPrice === 0 && weightedOutputPrice === 0) return null;
  return (inputTokens / 1e6) * weightedInputPrice + (outputTokens / 1e6) * weightedOutputPrice;
}

/**
 * AA listed-pricing mode with an assumed cache-hit rate for input tokens:
 *   input  = cacheHitRate*inputTokens/1e6 * cacheHitPrice
 *          + (1-cacheHitRate)*inputTokens/1e6 * price1mInputTokens
 *   output = outputTokens/1e6 * price1mOutputTokens
 *
 * cacheWritePrice is deliberately NOT part of the estimate: upstream cache
 * WRITE token volumes are unknown, and inventing them would misprice the
 * workload. Returns null when the entire listing is zero (no listed pricing).
 * Out-of-range cacheHitRate values are clamped into [0, 1].
 */
export function listedCostUsd(
  listed: Readonly<DerivedAaChartRecord["listed"]>,
  inputTokens: number,
  outputTokens: number,
  cacheHitRate: number,
): number | null {
  const { price1mInputTokens, price1mOutputTokens, cacheHitPrice } = listed;
  if (!usablePrice(price1mInputTokens) || !usablePrice(price1mOutputTokens) || !usablePrice(cacheHitPrice)) {
    return null;
  }
  if (price1mInputTokens === 0 && price1mOutputTokens === 0 && cacheHitPrice === 0) return null;
  const rate = Math.min(1, Math.max(0, cacheHitRate));
  if (!Number.isFinite(rate)) return null;
  const hitTokens = inputTokens * rate;
  const missTokens = inputTokens - hitTokens;
  return (
    (hitTokens / 1e6) * cacheHitPrice +
    (missTokens / 1e6) * price1mInputTokens +
    (outputTokens / 1e6) * price1mOutputTokens
  );
}
