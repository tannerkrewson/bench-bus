/**
 * Deterministic AA-listed cost/score frontier used by ingestion and matching.
 * This module deliberately works on canonical AA records, rather than chart
 * points, so collection and derived builds use the same 90% cache-hit rule.
 */
import type { ArtificialAnalysisModel } from "../../schemas";
import { aaModelIdentityKey } from "../../schemas";

export const AA_FRONTIER_CACHE_HIT_RATE = 0.9;

export interface AaFrontierIdentity {
  slug: string;
  id: string;
}

export interface AaListedFrontierPoint extends AaFrontierIdentity {
  costUsd: number;
  intelligenceIndex: number;
}

/** Cost of the canonical Intelligence Index workload at AA listed prices. */
export function aaListedWorkloadCost(
  model: Pick<ArtificialAnalysisModel, "price1mInputTokens" | "price1mOutputTokens" | "cacheHitPrice" | "canonicalIntelligenceIndexTokenCount">,
  cacheHitRate = AA_FRONTIER_CACHE_HIT_RATE,
): number | null {
  const { input, output } = model.canonicalIntelligenceIndexTokenCount;
  const { price1mInputTokens: inputPrice, price1mOutputTokens: outputPrice, cacheHitPrice } = model;
  if (![input, output, inputPrice, outputPrice, cacheHitPrice, cacheHitRate].every(Number.isFinite)) return null;
  if (input < 0 || output < 0 || inputPrice < 0 || outputPrice < 0 || cacheHitPrice < 0) return null;
  if (cacheHitRate < 0 || cacheHitRate > 1) return null;
  const cost =
    (input * cacheHitRate / 1e6) * cacheHitPrice +
    (input * (1 - cacheHitRate) / 1e6) * inputPrice +
    (output / 1e6) * outputPrice;
  return Number.isFinite(cost) && cost > 0 ? cost : null;
}

/**
 * Return non-dominated AA-listed points, sorted by cost then identity.
 * Lower cost and higher score are better. Equal-cost models are represented
 * by their highest-score identity (identity is the deterministic tie-break).
 * Invalid or unplottable records are ignored rather than becoming zero-cost
 * frontier entries.
 */
export function computeAaListedParetoFrontier(
  models: readonly ArtificialAnalysisModel[],
  cacheHitRate = AA_FRONTIER_CACHE_HIT_RATE,
): AaListedFrontierPoint[] {
  const byIdentity = new Map<string, AaListedFrontierPoint>();
  for (const model of models) {
    const costUsd = aaListedWorkloadCost(model, cacheHitRate);
    if (costUsd === null || !Number.isFinite(model.intelligenceIndex)) continue;
    const point = { slug: model.slug, id: model.id, costUsd, intelligenceIndex: model.intelligenceIndex };
    const identity = aaModelIdentityKey(point);
    // Normalization already keeps the first duplicate. Keeping that same
    // rule here makes the helper safe when called directly in tests/tools.
    if (!byIdentity.has(identity)) byIdentity.set(identity, point);
  }
  const candidates = [...byIdentity.values()].sort((a, b) =>
    a.costUsd - b.costUsd ||
    b.intelligenceIndex - a.intelligenceIndex ||
    aaModelIdentityKey(a).localeCompare(aaModelIdentityKey(b)),
  );

  const frontier: AaListedFrontierPoint[] = [];
  let bestScore = -Infinity;
  for (let i = 0; i < candidates.length;) {
    const first = candidates[i]!;
    let bestAtCost = first;
    let j = i + 1;
    while (j < candidates.length && candidates[j]!.costUsd === first.costUsd) {
      const candidate = candidates[j]!;
      if (
        candidate.intelligenceIndex > bestAtCost.intelligenceIndex ||
        (candidate.intelligenceIndex === bestAtCost.intelligenceIndex &&
          aaModelIdentityKey(candidate).localeCompare(aaModelIdentityKey(bestAtCost)) < 0)
      ) bestAtCost = candidate;
      j += 1;
    }
    if (bestAtCost.intelligenceIndex > bestScore) {
      frontier.push(bestAtCost);
      bestScore = bestAtCost.intelligenceIndex;
    }
    i = j;
  }
  return frontier;
}

export function aaFrontierSlugs(
  models: readonly ArtificialAnalysisModel[],
  cacheHitRate = AA_FRONTIER_CACHE_HIT_RATE,
): string[] {
  return computeAaListedParetoFrontier(models, cacheHitRate).map((point) => point.slug);
}
