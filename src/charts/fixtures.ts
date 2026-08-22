import {
  CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS,
  type DerivedAaChartRecord,
  type DerivedCursorChartRecord,
} from "../schemas";
import type {
  BenchmarkChartAdapter,
  PlottablePoint,
  PricingControlState,
  TooltipLine,
} from "./types";
import { inferModelBrand } from "./brand";
import { modelDisplayMetadata } from "./modelMetadata";

/**
 * Fixture datasets shaped exactly like the derived browser contracts plus
 * reference adapters. They prove the generic chart system works for both
 * benchmark shapes and serve as reference implementations for the concrete
 * AA and CursorBench chart issues.
 */

export const AA_FIXTURE_RECORDS: readonly DerivedAaChartRecord[] = [
  {
    slug: "claude-opus-5",
    name: "Claude Opus 5",
    shortName: "Opus 5",
    intelligenceIndex: 71.2,
    canonicalTokens: { input: 810_078_135, output: 114_542_834 },
    providers: [
      { providerName: "Azure (US)", providerSlug: "azure-us", effectiveInputPrice: 2.5, effectiveOutputPrice: 12.5 },
      { providerName: "Bedrock", providerSlug: "bedrock", effectiveInputPrice: 2.2, effectiveOutputPrice: 13.9 },
    ],
    weighted: { weightedInputPrice: 2.4, weightedOutputPrice: 13.0 },
    listed: { price1mInputTokens: 2.5, price1mOutputTokens: 12.5, cacheHitPrice: 0.3 },
  },
  {
    slug: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    shortName: "GPT-5.6",
    intelligenceIndex: 74.8,
    canonicalTokens: { input: 640_112_004, output: 98_220_115 },
    providers: [
      { providerName: "OpenAI", providerSlug: "openai", effectiveInputPrice: 1.4, effectiveOutputPrice: 9.8 },
    ],
    weighted: { weightedInputPrice: 1.5, weightedOutputPrice: 10.1 },
    listed: { price1mInputTokens: 1.4, price1mOutputTokens: 9.8, cacheHitPrice: 0.2 },
  },
  {
    slug: "gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    shortName: "Gemini 3.7F",
    intelligenceIndex: 62.4,
    canonicalTokens: { input: 402_881_440, output: 61_003_988 },
    providers: [
      { providerName: "AI Studio", providerSlug: "ai-studio", effectiveInputPrice: 0.35, effectiveOutputPrice: 1.9 },
      { providerName: "Vertex", providerSlug: "vertex", effectiveInputPrice: 0.4, effectiveOutputPrice: 2.1 },
    ],
    weighted: { weightedInputPrice: 0.37, weightedOutputPrice: 1.95 },
    listed: { price1mInputTokens: 0.35, price1mOutputTokens: 1.9, cacheHitPrice: 0.05 },
  },
  {
    // No providers: unplottable under provider-based pricing modes.
    slug: "mystery-model",
    name: "Mystery Model",
    shortName: "Mystery",
    intelligenceIndex: 40.1,
    canonicalTokens: { input: 100_000_000, output: 10_000_000 },
    providers: [],
    weighted: { weightedInputPrice: 0, weightedOutputPrice: 0 },
    listed: { price1mInputTokens: 0, price1mOutputTokens: 0, cacheHitPrice: 0 },
  },
];

export const CURSOR_FIXTURE_RECORDS: readonly DerivedCursorChartRecord[] = [
  {
    modelId: "composer-2",
    modelName: "Composer 2",
    provider: "cursor",
    isThirdParty: false,
    score: 70.8,
    publishedCostUsd: 2.81,
    tokensPerTask: 41_136,
  },
  {
    modelId: "opus-5-max",
    modelName: "Opus 5 Max",
    provider: "anthropic",
    isThirdParty: true,
    score: 68.4,
    inputTokens: 1_200_000,
    outputTokens: 300_000,
    publishedCostUsd: 3.4,
    tokensPerTask: 1_500_000,
  },
  {
    modelId: "gemini-3.7-flash",
    modelName: "Gemini 3.7 Flash",
    provider: "google",
    isThirdParty: true,
    score: 55.2,
    publishedCostUsd: 0.42,
    tokensPerTask: 180_500,
  },
];

const AA_MODE_CONTROL = {
  kind: "select",
  id: "pricingMode",
  label: "Pricing mode",
  default: "cheapest",
  description: "How OpenRouter/AA prices are combined into one cost estimate.",
  options: [
    { value: "cheapest", label: "Cheapest single provider" },
    { value: "weighted", label: "OpenRouter weighted" },
    { value: "listed", label: "AA listed (cache-hit est.)" },
  ],
} as const;

const AA_CACHE_CONTROL = {
  kind: "slider",
  id: "cacheHitRate",
  label: "Cache hit rate",
  default: 0.9,
  min: 0,
  max: 1,
  step: 0.01,
  description: "Share of input tokens assumed served from cache (listed mode).",
  format: (v: number) => `${Math.round(v * 100)}%`,
} as const;

/** Cheapest single provider by combined benchmark-workload cost. */
export function cheapestProviderCostUsd(
  inputTokens: number,
  outputTokens: number,
  providers: readonly { effectiveInputPrice: number; effectiveOutputPrice: number }[],
): number | null {
  let best: number | null = null;
  for (const p of providers) {
    const cost = (inputTokens / 1e6) * p.effectiveInputPrice + (outputTokens / 1e6) * p.effectiveOutputPrice;
    if (best === null || cost < best) best = cost;
  }
  return best;
}

export const aaDemoAdapter: BenchmarkChartAdapter<DerivedAaChartRecord> = {
  benchmarkId: "aa-demo",
  title: "Artificial Analysis model value",
  subtitle: "Intelligence Index score versus estimated benchmark workload cost per task.",
  xAxisLabel: "Estimated benchmark cost (USD)",
  yAxisLabel: "Intelligence Index",
  defaultXScale: "log",
  controlSpecs: [AA_MODE_CONTROL, AA_CACHE_CONTROL],
  identity: (record) => ({ id: record.slug, label: modelDisplayMetadata(record.name, record.slug).label }),
  computePoint: (record, controls: Readonly<PricingControlState>): PlottablePoint | null => {
    const mode = controls["pricingMode"] ?? AA_MODE_CONTROL.default;
    const cacheHitRate = Number(controls["cacheHitRate"] ?? AA_CACHE_CONTROL.default);
    const { input, output } = record.canonicalTokens;
    let cost: number | null = null;
    if (mode === "cheapest") {
      cost = cheapestProviderCostUsd(input, output, record.providers);
    } else if (mode === "weighted") {
      if (record.weighted.weightedInputPrice === 0 && record.weighted.weightedOutputPrice === 0) {
        cost = null;
      } else {
        cost = (input / 1e6) * record.weighted.weightedInputPrice + (output / 1e6) * record.weighted.weightedOutputPrice;
      }
    } else {
      if (record.listed.price1mInputTokens === 0 && record.listed.price1mOutputTokens === 0) {
        cost = null;
      } else {
        // Cache-write volume is unknown upstream, so it is deliberately omitted.
        const hitTokens = input * cacheHitRate;
        const missTokens = input - hitTokens;
        cost =
          (hitTokens / 1e6) * record.listed.cacheHitPrice +
          (missTokens / 1e6) * record.listed.price1mInputTokens +
          (output / 1e6) * record.listed.price1mOutputTokens;
      }
    }
    if (cost === null || !Number.isFinite(cost) || cost <= 0) return null;
    const metadata = modelDisplayMetadata(record.name, record.slug);
    return {
      id: record.slug,
      label: metadata.label,
      selectionLabel: record.name,
      brand: inferModelBrand(record.name, record.slug),
      effortGroup: metadata.groupKey,
      x: cost,
      y: record.intelligenceIndex,
    };
  },
  searchText: (record) => `${record.name} ${record.shortName} ${record.slug}`,
  tooltipLines: (record, point): readonly TooltipLine[] => [
    { label: "Score", value: record.intelligenceIndex.toFixed(1) },
    { label: "Est. cost", value: `$${point.x.toFixed(2)}` },
    { label: "Workload input", value: `${(record.canonicalTokens.input / 1e6).toFixed(1)}M tok` },
    { label: "Workload output", value: `${(record.canonicalTokens.output / 1e6).toFixed(1)}M tok` },
  ],
};

export const cursorDemoAdapter: BenchmarkChartAdapter<DerivedCursorChartRecord> = {
  benchmarkId: "cursor-demo",
  title: "Cursor model value",
  subtitle: "CursorBench score versus average benchmark workload cost per task.",
  xAxisLabel: "Avg cost per task (USD)",
  yAxisLabel: "CursorBench score",
  defaultXScale: "log",
  controlSpecs: [
    {
      kind: "toggle",
      id: "surcharge",
      label: "Third-party surcharge ($0.25/M tok)",
      default: false,
      description: "Applies Cursor's flat third-party-model surcharge to applicable usage.",
    },
  ],
  identity: (record) => ({ id: record.modelId, label: modelDisplayMetadata(record.modelName, record.modelId).label }),
  computePoint: (record, controls): PlottablePoint | null => {
    const base = record.publishedCostUsd;
    if (base === undefined) return null;
    let cost = base;
    const surchargeOn = Boolean(controls["surcharge"] ?? false);
    if (surchargeOn && record.isThirdParty) {
      const tokens = (record.inputTokens ?? 0) + (record.outputTokens ?? 0);
      cost += (tokens / 1e6) * CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS;
    }
    if (!Number.isFinite(cost) || cost <= 0) return null;
    const metadata = modelDisplayMetadata(record.modelName, record.modelId);
    return {
      id: record.modelId,
      label: metadata.label,
      selectionLabel: record.modelName,
      brand: inferModelBrand(record.modelName, record.provider, record.modelId),
      effortGroup: metadata.groupKey,
      x: cost,
      y: record.score,
    };
  },
  searchText: (record) => `${record.modelName} ${record.provider}`,
  tooltipLines: (record, point): readonly TooltipLine[] => [
    { label: "Score", value: `${record.score.toFixed(1)}%` },
    { label: "Avg cost/task", value: `$${point.x.toFixed(2)}` },
    { label: "Provider", value: record.provider },
  ],
};
