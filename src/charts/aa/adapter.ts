import type { DerivedAaChartRecord } from "../../schemas";
import type {
  BenchmarkChartAdapter,
  PlottablePoint,
  PricingControlState,
  TooltipLine,
} from "../types";
import {
  AA_DEFAULT_CACHE_HIT_RATE,
  listedCostUsd,
  selectCheapestProvider,
  weightedCostUsd,
} from "./pricing";

/** URL/namespace id of the Artificial Analysis chart. */
export const AA_BENCHMARK_ID = "aa";

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

export const AA_CONTROL_SPECS = [PRICING_MODE_CONTROL, CACHE_HIT_CONTROL] as const;

function pricingModeLabel(mode: string): string {
  switch (mode) {
    case "cheapest":
      return "Cheapest single provider (OpenRouter effective)";
    case "weighted":
      return "OpenRouter weighted effective";
    case "listed":
      return "AA listed (cache-hit estimate)";
    default:
      return mode;
  }
}

/**
 * Real Artificial Analysis adapter: Intelligence Index (Y) versus the
 * estimated cost of the actual canonical benchmark workload (X).
 */
export const aaAdapter: BenchmarkChartAdapter<DerivedAaChartRecord> = {
  benchmarkId: AA_BENCHMARK_ID,
  xAxisLabel: "Estimated Intelligence Index workload cost (USD)",
  yAxisLabel: "Intelligence Index",
  defaultXScale: "log",
  controlSpecs: AA_CONTROL_SPECS,

  identity: (record) => ({ id: record.slug, label: record.name }),

  computePoint: (record, controls: Readonly<PricingControlState>): PlottablePoint | null => {
    const mode = controls["pricingMode"] ?? PRICING_MODE_CONTROL.default;
    const cacheHitRate = Number(controls["cacheHitRate"] ?? AA_DEFAULT_CACHE_HIT_RATE);
    const { input, output } = record.canonicalTokens;

    let cost: number | null;
    switch (mode) {
      case "cheapest":
        cost = selectCheapestProvider(record.providers, input, output)?.totalCostUsd ?? null;
        break;
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
    return { id: record.slug, label: record.name, x: cost, y: record.intelligenceIndex };
  },

  searchText: (record) => `${record.name} ${record.shortName} ${record.slug}`,

  tooltipLines: (record, point): readonly TooltipLine[] => [
    { label: "Intelligence Index", value: record.intelligenceIndex.toFixed(1) },
    { label: "Est. workload cost", value: `$${point.x.toFixed(2)}` },
    {
      label: "Workload tokens",
      value: `${(record.canonicalTokens.input / 1e6).toFixed(1)}M in / ${(
        record.canonicalTokens.output / 1e6
      ).toFixed(1)}M out`,
    },
  ],

  disclaimer:
    "Cost estimates use each model's actual canonical Intelligence Index token counts and snapshot pricing; " +
    "effective OpenRouter prices are 30-day realized averages and cheapest-provider results are snapshots, not guaranteed future routing prices. " +
    "A benchmark score reduces model quality to one number, and models need different token counts for equivalent work — " +
    "Bench Bus intentionally charges the actual benchmark workload so this shows up in cost. " +
    "Listed-price estimates depend on the user-selected cache-hit rate; cache-write volume is unknown and omitted.",
};

/**
 * Tooltip rows that depend on the current control state (pricing mode label
 * and, in cheapest mode, the winning provider). The frozen generic section
 * calls adapter.tooltipLines(record, point) without controls, so the AA
 * section composes the chart primitives directly to layer these on.
 */
export function aaControlledTooltipLines(
  record: DerivedAaChartRecord,
  point: PlottablePoint,
  controls: Readonly<PricingControlState>,
): readonly TooltipLine[] {
  const mode = String(controls["pricingMode"] ?? PRICING_MODE_CONTROL.default);
  const lines: TooltipLine[] = [
    { label: "Intelligence Index", value: record.intelligenceIndex.toFixed(1) },
    { label: "Est. workload cost", value: `$${point.x.toFixed(2)}` },
    { label: "Pricing mode", value: pricingModeLabel(mode) },
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
