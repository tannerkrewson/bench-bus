import type { DerivedAaChartRecord } from "../../schemas";
import type {
  BenchmarkChartAdapter,
  PlottablePoint,
  PricingControlState,
  TooltipLine,
  PriceDiscountAnnotation,
} from "../types";
import { inferModelBrand } from "../brand";
import { isNonReasoningModel, modelDisplayMetadata } from "../modelMetadata";
import { discountPercentageFromCosts } from "../plotData";
import {
  AA_DEFAULT_CACHE_HIT_RATE,
  listedCostUsd,
  selectCheapestProvider,
  weightedCostUsd,
} from "./pricing";

/** URL/namespace id of the Artificial Analysis chart. */
export const AA_BENCHMARK_ID = "aa";
export const AA_SCORE_SOURCE_CONTROL_ID = "scoreSource";

type AaScoreSource = "aa" | "deepswe";

/**
 * Confirmed AA -> OpenRouter identities from the committed alias mapping,
 * plus the explicitly curated DeepSeek identity. Effort variants share the
 * OpenRouter base page; unknown identities deliberately have no link.
 */
const CONFIRMED_OPENROUTER_MODEL_IDS: Readonly<Record<string, string>> = {
  "claude-opus-5": "anthropic/claude-opus-5",
  "claude-opus-5-high": "anthropic/claude-opus-5",
  "claude-opus-5-medium": "anthropic/claude-opus-5",
  "claude-opus-5-xhigh": "anthropic/claude-opus-5",
  "claude-sonnet-5": "anthropic/claude-sonnet-5",
  "deepseek-v4-flash-0731": "deepseek/deepseek-v4-flash-0731",
  "deepseek-v4-flash": "deepseek/deepseek-v4-flash-0731",
  "deepseek-v4-flash-0420": "deepseek/deepseek-v4-flash",
  "deepseek-v4-pro": "deepseek/deepseek-v4-pro-0813",
  "deepseek-v4-pro-0424": "deepseek/deepseek-v4-pro",
  "gemini-3-7-flash": "google/gemini-3.7-flash",
  "gemini-3-7-flash-low": "google/gemini-3.7-flash",
  "gemini-3-7-flash-medium": "google/gemini-3.7-flash",
  "glm-5-3": "z-ai/glm-5.3",
  "glm-5-3-flash": "z-ai/glm-5.3-flash",
  "gpt-5-6-luna": "openai/gpt-5.6-luna",
  "gpt-5-6-luna-high": "openai/gpt-5.6-luna",
  "gpt-5-6-luna-low": "openai/gpt-5.6-luna",
  "gpt-5-6-luna-medium": "openai/gpt-5.6-luna",
  "gpt-5-6-luna-non-reasoning": "openai/gpt-5.6-luna",
  "gpt-5-6-luna-xhigh": "openai/gpt-5.6-luna",
  "gpt-5-6-sol": "openai/gpt-5.6-sol",
  "gpt-5-6-sol-low": "openai/gpt-5.6-sol",
  "gpt-5-6-sol-medium": "openai/gpt-5.6-sol",
  "gpt-5-6-sol-high": "openai/gpt-5.6-sol",
  "gpt-5-6-sol-xhigh": "openai/gpt-5.6-sol",
  "glm-5-2": "z-ai/glm-5.2",
  "hy3": "tencent/hy3",
  "grok-4-6": "x-ai/grok-4.6",
  "grok-4-6-high": "x-ai/grok-4.6",
  "grok-4-6-medium": "x-ai/grok-4.6",
  "kimi-k3": "moonshotai/kimi-k3",
  "mimo-v2-5": "xiaomi/mimo-v2.5",
  "mimo-v2-5-0424": "xiaomi/mimo-v2.5",
  "muse-spark-1-2": "meta/muse-spark-1.2-contributor",
  "nvidia-nemotron-3-super-120b-a12b": "nvidia/nemotron-3-super-120b-a12b",
  "qwen3-8-max": "qwen/qwen3.8-max",
  "qwen3-8-flash-next": "qwen/qwen3.8-flash",
};

export function openRouterUrlForAaModel(
  record: Pick<DerivedAaChartRecord, "slug">,
): string | undefined {
  const modelId = CONFIRMED_OPENROUTER_MODEL_IDS[record.slug];
  return modelId === undefined ? undefined : `https://openrouter.ai/${modelId}`;
}

const PRICING_MODE_CONTROL = {
  kind: "select",
  id: "pricingMode",
  label: "Pricing mode",
  default: "cheapest",
  description:
    "How model pricing is estimated: one real OpenRouter provider chosen by total benchmark cost, OpenRouter model-wide weighted prices, or AA's listed prices.",
  options: [
    { value: "cheapest", label: "Cheapest single provider" },
    { value: "weighted", label: "OpenRouter weighted" },
    { value: "listed", label: "AA listed (cache-hit est.)" },
  ],
} as const;

const SCORE_SOURCE_CONTROL = {
  kind: "select",
  id: AA_SCORE_SOURCE_CONTROL_ID,
  label: "Score source",
  default: "aa",
  description: "Choose the benchmark that supplies the graph's vertical score.",
  options: [
    { value: "aa", label: "Artificial Analysis" },
    { value: "deepswe", label: "DeepSWE pass@1" },
  ],
} as const;

const CACHE_HIT_CONTROL = {
  kind: "slider",
  id: "cacheHitRate",
  label: "Cache hit rate (listed mode)",
  default: AA_DEFAULT_CACHE_HIT_RATE,
  min: 0,
  max: 1,
  step: 0.01,
  description:
    "Share of input tokens assumed served from cache when estimating AA listed prices. Cache-write volume is unknown upstream and is not estimated.",
  format: (v: number) => `${Math.round(v * 100)}%`,
} as const;

export const AA_CONTROL_SPECS = [SCORE_SOURCE_CONTROL, PRICING_MODE_CONTROL, CACHE_HIT_CONTROL] as const;

function scoreForSource(record: DerivedAaChartRecord, controls: Readonly<PricingControlState>): number | null {
  const source = String(controls[AA_SCORE_SOURCE_CONTROL_ID] ?? SCORE_SOURCE_CONTROL.default) as AaScoreSource;
  if (source === "deepswe") {
    const score = record.scoreSources.deepSwePassAt1;
    return score === undefined ? null : score * 100;
  }
  return record.scoreSources.artificialAnalysis;
}

export function aaYAxisLabel(controls: Readonly<PricingControlState>): string {
  return String(controls[AA_SCORE_SOURCE_CONTROL_ID] ?? SCORE_SOURCE_CONTROL.default) === "deepswe"
    ? "DeepSWE pass@1 (%)"
    : "Intelligence Index";
}

function providerDiscountAnnotation(
  provider: DerivedAaChartRecord["providers"][number],
  inputTokens: number,
  outputTokens: number,
  plottedCost?: number,
): PriceDiscountAnnotation | undefined {
  const effectiveX =
    (inputTokens / 1e6) * provider.effectiveInputPrice +
    (outputTokens / 1e6) * provider.effectiveOutputPrice;
  const listedInput = provider.listedInputPrice;
  const listedOutput = provider.listedOutputPrice;
  const explicitPercentage = provider.discountPercentage;
  const listedPreDiscountX =
    listedInput !== undefined && listedOutput !== undefined && listedInput > 0 && listedOutput > 0
      ? (inputTokens / 1e6) * listedInput + (outputTokens / 1e6) * listedOutput
      : undefined;
  // Direct listed prices are authoritative. The explicit percentage is only
  // a fallback when no listed prices exist; stale metadata must not change
  // the percentage implied by the displayed workload prices.
  const preDiscountX = listedPreDiscountX ?? (
    explicitPercentage !== undefined && explicitPercentage > 0 && explicitPercentage < 100
      ? effectiveX / (1 - explicitPercentage / 100)
      : undefined
  );
  if (!Number.isFinite(effectiveX) || effectiveX < 0 || preDiscountX === undefined || preDiscountX <= effectiveX) {
    return undefined;
  }
  if (explicitPercentage !== undefined && explicitPercentage <= 0) return undefined;
  // OpenRouter publishes provider-level discount percentages for some
  // endpoints. A model-linked tier (such as Contributor) instead declares
  // its undiscounted model identity in the mapping. In both cases the
  // displayed percentage is recomputed from the source-backed workload costs.
  if (explicitPercentage === undefined && provider.undiscountedModelId === undefined) return undefined;
  const percentage = discountPercentageFromCosts(preDiscountX, effectiveX);
  if (percentage === undefined || !Number.isFinite(percentage) || percentage <= 0 || percentage > 100) return undefined;
  const tolerance = plottedCost === undefined ? 0 : Math.max(0.005, Math.abs(plottedCost) * 1e-6);
  return {
    percentage,
    preDiscountX,
    effectiveX,
    providerName: provider.providerName,
    ...(provider.undiscountedModelId ? { undiscountedModelId: provider.undiscountedModelId } : {}),
    ...(plottedCost === undefined
      ? {}
      : { providerRole: Math.abs(effectiveX - plottedCost) <= tolerance ? "plotted" : "alternative" }),
  };
}

function explicitProviderDiscount(
  record: DerivedAaChartRecord,
  winner: ReturnType<typeof selectCheapestProvider>,
): PriceDiscountAnnotation | undefined {
  if (!winner) return undefined;
  const annotation = providerDiscountAnnotation(
    winner,
    record.canonicalTokens.input,
    record.canonicalTokens.output,
  );
  if (!annotation) return undefined;
  return {
    percentage: annotation.percentage,
    preDiscountX: annotation.preDiscountX,
    ...(annotation.providerName ? { providerName: annotation.providerName } : {}),
    ...(annotation.undiscountedModelId
      ? { undiscountedModelId: annotation.undiscountedModelId }
      : {}),
  };
}

function explicitProviderDiscounts(
  record: DerivedAaChartRecord,
  plottedCost: number,
  plottedProviderName?: string,
): PriceDiscountAnnotation[] {
  return record.providers.flatMap((provider) => {
    const annotation = providerDiscountAnnotation(
      provider,
      record.canonicalTokens.input,
      record.canonicalTokens.output,
      plottedCost,
    );
    if (!annotation) return [];
    return [{
      ...annotation,
      ...(plottedProviderName && annotation.providerName !== plottedProviderName && annotation.providerRole === "alternative"
        ? { plottedProviderName }
        : {}),
    }];
  });
}

/**
 * Real Artificial Analysis adapter: Intelligence Index (Y) versus the
 * estimated cost of the actual canonical benchmark workload (X).
 */
export const aaAdapter: BenchmarkChartAdapter<DerivedAaChartRecord> = {
  benchmarkId: AA_BENCHMARK_ID,
  title: "Best value models on OpenRouter",
  subtitle: [
    { label: "Artificial Analysis", href: "https://artificialanalysis.ai/" },
    " shows standard model pricing, but models can have discounts and cheaper providers on ",
    { label: "OpenRouter", href: "https://openrouter.ai/" },
    ". This chart uses the latest prices and discounts from ",
    { label: "OpenRouter", href: "https://openrouter.ai/" },
    " to find the real models on the Pareto frontier.\nNote, some open models, mainly DeepSeek, can swing wildly in price by the hour around Chinese business hours and weekends, but Bench Bus automatically updates multiple times per day.",
  ],
  xAxisLabel: "Estimated Intelligence Index workload cost (USD)",
  yAxisLabel: "Intelligence Index",
  defaultXScale: "log",
  controlSpecs: AA_CONTROL_SPECS,

  identity: (record) => ({ id: record.slug, label: modelDisplayMetadata(record.name, record.slug).label }),
  openRouterUrl: openRouterUrlForAaModel,

  computePoint: (record, controls: Readonly<PricingControlState>): PlottablePoint | null => {
    // AA publishes non-reasoning base rows beside reasoning variants. The
    // chart intentionally excludes every explicitly marked non-reasoning row
    // so it cannot leak into selection, overlays, or frontier calculations.
    if (isNonReasoningModel(record.name, record.slug)) return null;
    const score = scoreForSource(record, controls);
    if (score === null) return null;
    const mode = controls["pricingMode"] ?? PRICING_MODE_CONTROL.default;
    const cacheHitRate = Number(controls["cacheHitRate"] ?? AA_DEFAULT_CACHE_HIT_RATE);
    const { input, output } = record.canonicalTokens;

    let cost: number | null;
    let discount: PriceDiscountAnnotation | undefined;
    let plottedProviderName: string | undefined;
    switch (mode) {
      case "cheapest": {
        const winner = selectCheapestProvider(record.providers, input, output);
        cost = winner?.totalCostUsd ?? null;
        plottedProviderName = winner?.providerName;
        discount = explicitProviderDiscount(record, winner);
        break;
      }
      case "weighted":
        cost = weightedCostUsd(record.weighted, input, output);
        break;
      case "listed":
        cost = listedCostUsd(record.listed, input, output, cacheHitRate);
        break;
      default:
        cost = null;
    }
    if (cost === null || !Number.isFinite(cost) || cost <= 0) return null;
    const metadata = modelDisplayMetadata(record.name, record.slug);
    return {
      id: record.slug,
      label: metadata.label,
      // Preserve existing concise source names, but never leak verbose
      // parenthetical metadata into selector names.
      selectionLabel: record.name.includes("(") ? metadata.label : record.name,
      brand: inferModelBrand(record.name, record.slug),
      effortGroup: metadata.groupKey,
      ...(metadata.effort ? { effort: metadata.effort } : {}),
      x: cost,
      y: score,
      ...(discount ? { discount } : {}),
      ...(mode === "cheapest"
        ? { discounts: explicitProviderDiscounts(record, cost, plottedProviderName) }
        : {}),
    };
  },

  searchText: (record) => `${record.name} ${record.shortName} ${record.slug}`,

  tooltipLines: (record, point, controls): readonly TooltipLine[] =>
    aaControlledTooltipLines(record, point, controls),

};

/**
 * Tooltip rows that depend on the current control state (pricing mode label
 * and, in cheapest mode, the winning provider). The generic chart passes the
 * live controls through this adapter contract; the AA section also uses this
 * helper because it owns the selected-model visibility shell.
 */
export function aaControlledTooltipLines(
  record: DerivedAaChartRecord,
  point: PlottablePoint,
  controls: Readonly<PricingControlState>,
): readonly TooltipLine[] {
  const mode = String(controls["pricingMode"] ?? PRICING_MODE_CONTROL.default);
  const scoreSource = String(controls[AA_SCORE_SOURCE_CONTROL_ID] ?? SCORE_SOURCE_CONTROL.default);
  const lines: TooltipLine[] = [
    {
      label: scoreSource === "deepswe" ? "DeepSWE pass@1" : "Intelligence Index",
      value: scoreSource === "deepswe" ? `${(point.y / 100).toFixed(3)} (${point.y.toFixed(1)}%)` : point.y.toFixed(1),
    },
    { label: "Est. workload cost", value: `$${point.x.toFixed(2)}` },
  ];
  if (mode === "cheapest") {
    const winner = selectCheapestProvider(
      record.providers,
      record.canonicalTokens.input,
      record.canonicalTokens.output,
    );
    lines.push({
      label: "Winning provider",
      value: winner ? `${winner.providerName} ($${winner.totalCostUsd.toFixed(2)})` : "none",
    });
  }
  if (mode === "listed") {
    lines.push({
      label: "Cache hit rate",
      value: `${Math.round(Number(controls["cacheHitRate"] ?? AA_DEFAULT_CACHE_HIT_RATE) * 100)}% (cache writes unknown/omitted)`,
    });
  }
  lines.push({
    label: "Workload tokens",
    value: `${(record.canonicalTokens.input / 1e6).toFixed(1)}M in / ${(
      record.canonicalTokens.output / 1e6
    ).toFixed(1)}M out`,
  });
  return lines;
}
