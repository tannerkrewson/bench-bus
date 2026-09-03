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
import aliasFile from "../../collectors/openrouter/openrouter-aliases.json";
import curatedModelFile from "../../collectors/openrouter/curated-models.json";
import {
  AA_DEFAULT_CACHE_HIT_RATE,
  AA_SAVINGS_TOLERANCE_RATE,
  AA_SAVINGS_TOLERANCE_USD,
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
const CONFIRMED_OPENROUTER_MODEL_IDS: Readonly<Record<string, string>> = Object.fromEntries([
  ...curatedModelFile.models.map((entry) => [entry.aaModelSlug, entry.openrouterId] as const),
  ...aliasFile.entries
    .filter((entry) => entry.status === "confirmed")
    .map((entry) => [entry.aaModelSlug, entry.openrouterId] as const),
]);

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
    "Uses the cheapest OpenRouter provider when available, falls back to AA listed prices for new models, or compares OpenRouter weighted and AA listed pricing.",
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

function aaListedSavingsDiscount(
  record: DerivedAaChartRecord,
  winner: ReturnType<typeof selectCheapestProvider>,
  cacheHitRate: number,
): PriceDiscountAnnotation | undefined {
  if (!winner) return undefined;
  const preDiscountX = listedCostUsd(
    record.listed,
    record.canonicalTokens.input,
    record.canonicalTokens.output,
    cacheHitRate,
  );
  if (preDiscountX === null || winner.totalCostUsd >= preDiscountX) return undefined;
  const savingsUsd = preDiscountX - winner.totalCostUsd;
  const tolerance = Math.max(AA_SAVINGS_TOLERANCE_USD, preDiscountX * AA_SAVINGS_TOLERANCE_RATE);
  if (savingsUsd <= tolerance) return undefined;
  const percentage = discountPercentageFromCosts(preDiscountX, winner.totalCostUsd);
  if (percentage === undefined) return undefined;
  return {
    percentage,
    preDiscountX,
    effectiveX: winner.totalCostUsd,
    providerName: winner.providerName,
  };
}

/**
 * Real Artificial Analysis adapter: Intelligence Index (Y) versus the
 * estimated cost of the actual canonical benchmark workload (X).
 */
export const aaAdapter: BenchmarkChartAdapter<DerivedAaChartRecord> = {
  benchmarkId: AA_BENCHMARK_ID,
  title: "Best value models on OpenRouter",
  subtitle: "This chart compares AA listed prices with the cheapest effective OpenRouter provider for the real benchmark workload, updated multiple times per day as prices change",
  sourceLinks: [
    { label: "Artificial Analysis", href: "https://artificialanalysis.ai/" },
    { label: "OpenRouter", href: "https://openrouter.ai/" },
    { label: "DeepSWE", href: "https://deepswe.datacurve.ai/artifacts/v1/leaderboard-live.json" },
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
    switch (mode) {
      case "cheapest": {
        const winner = selectCheapestProvider(record.providers, input, output);
        if (winner) {
          cost = winner.totalCostUsd;
          discount = aaListedSavingsDiscount(record, winner, cacheHitRate);
        } else {
          // AA is the benchmark source of truth for new models. Keep them
          // visible before OpenRouter publishes a provider row, without
          // inventing a provider or a discount annotation.
          cost = listedCostUsd(record.listed, input, output, cacheHitRate);
        }
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
      // parenthetical metadata into selector names. DeepSeek release numbers
      // are canonicalized because bare AA slugs map to dated OpenRouter ids.
      selectionLabel:
        record.name.includes("(") || /deepseek/i.test(`${record.name} ${record.slug}`) ? metadata.label : record.name,
      brand: inferModelBrand(record.name, record.slug),
      effortGroup: metadata.groupKey,
      ...(metadata.effort ? { effort: metadata.effort } : {}),
      x: cost,
      y: score,
      ...(discount ? { discount } : {}),
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
      value: winner
        ? `${winner.providerName} ($${winner.totalCostUsd.toFixed(2)})`
        : record.providers.length === 0
          ? "AA listed pricing"
          : "none",
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
