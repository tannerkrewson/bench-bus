import type { OpenRouterProviderSummary } from "../../schemas/openrouter";

/**
 * The model's actual Artificial Analysis benchmark workload, in tokens.
 * These are the canonicalIntelligenceIndexTokenCount values from the AA
 * snapshot: the real token counts the benchmark run consumed.
 */
export interface BenchmarkWorkload {
  inputTokens: number;
  outputTokens: number;
}

export interface CheapestProviderResult {
  provider: OpenRouterProviderSummary;
  /** USD cost of the workload's input tokens at this provider. */
  inputCost: number;
  /** USD cost of the workload's output tokens at this provider. */
  outputCost: number;
  /** inputCost + outputCost; the minimized quantity. */
  totalCost: number;
}

/**
 * Total cost of the benchmark workload at one provider, using ONLY that
 * provider's effective prices. Never mix input pricing from one provider with
 * output pricing from another.
 */
export function workloadCost(
  workload: BenchmarkWorkload,
  provider: Pick<OpenRouterProviderSummary, "effectiveInputPrice" | "effectiveOutputPrice">,
): number {
  return (workload.inputTokens / 1e6) * provider.effectiveInputPrice +
    (workload.outputTokens / 1e6) * provider.effectiveOutputPrice;
}

/**
 * Select the single provider minimizing the combined benchmark workload cost.
 *
 * - Every provider competes, including rare/low-volume ones: totalTokens and
 *   cacheHitRate are deliberately ignored.
 * - The result is one provider for BOTH input and output pricing.
 * - Ties break toward the earlier provider in the upstream array, so the
 *   selection is deterministic for identical upstream data.
 * - Returns undefined only when there are no providers at all; callers treat
 *   that as "no data", never as zero cost.
 */
export function selectCheapestProvider(
  providers: readonly OpenRouterProviderSummary[],
  workload: BenchmarkWorkload,
): CheapestProviderResult | undefined {
  let best: CheapestProviderResult | undefined;
  for (const provider of providers) {
    const inputCost = (workload.inputTokens / 1e6) * provider.effectiveInputPrice;
    const outputCost = (workload.outputTokens / 1e6) * provider.effectiveOutputPrice;
    const totalCost = inputCost + outputCost;
    if (best === undefined || totalCost < best.totalCost) {
      best = { provider, inputCost, outputCost, totalCost };
    }
  }
  return best;
}
