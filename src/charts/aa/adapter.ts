import type { DerivedAaChartRecord } from "../../schemas";
import type {
  BenchmarkChartAdapter,
  PlottablePoint,
  PricingControlState,
  TooltipLine,
  PriceDiscountAnnotation,
} from "../types";
import { inferModelBrand } from "../brand";
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

function explicitProviderDiscount(
  record: DerivedAaChartRecord,
  winner: ReturnType<typeof selectCheapestProvider>,
): PriceDiscountAnnotation | undefined {
  if (!winner) return undefined;
  const percentage = winner.discountPercentage;
  const listedInput = winner.listedInputPrice;
  const listedOutput = winner.listedOutputPrice;
  if (
    percentage === undefined ||
    percentage <= 0 ||
    percentage >= 100 ||
    listedInput === undefined ||
    listedOutput === undefined ||
    listedInput <= 0 ||
    listedOutput <= 0
  ) return undefined;
  const preDiscountX =
    (record.canonicalTokens.input / 1e6) * listedInput +
    (record.canonicalTokens.output / 1e6) * listedOutput;
  // The percentage and both prices must come from this same winning provider;
  // never manufacture a discount from another provider or an unrelated
  // catalog/listed price. The explicit source percentage is not inferred from
  // the effective/listed price ratio.
  if (!Number.isFinite(preDiscountX) || preDiscountX <= winner.totalCostUsd) return undefined;
  return { percentage, preDiscountX, providerName: winner.providerName };
}

/**
 * Real Artificial Analysis adapter: Intelligence Index (Y) versus the
 * estimated cost of the actual canonical benchmark workload (X).
 */
export const aaAdapter: BenchmarkChartAdapter<DerivedAaChartRecord> = {
  benchmarkId: AA_BENCHMARK_ID,
  title: "Best value AI models",
  subtitle: "Artificial Analysis Intelligence Index score versus estimated benchmark workload cost per task.",
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
    let discount: PriceDiscountAnnotation | undefined;
    switch (mode) {
      case "cheapest": {
        const winner = selectCheapestProvider(record.providers, input, output);
        cost = winner?.totalCostUsd ?? null;
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
    return {
      id: record.slug,
      label: record.name,
      brand: inferModelBrand(record.name, record.slug),
      x: cost,
      y: record.intelligenceIndex,
      ...(discount ? { discount } : {}),
    };
  },

  searchText: (record) => `${record.name} ${record.shortName} ${record.slug}`,

  unplottableLabel: (controls) =>
    String(controls["pricingMode"] ?? PRICING_MODE_CONTROL.default) === "listed"
      ? "no listed rate"
      : "no OpenRouter price",
  unplottableDescription: (controls) =>
    String(controls["pricingMode"] ?? PRICING_MODE_CONTROL.default) === "listed"
      ? "No Artificial Analysis listed rate is available for this model."
      : "No OpenRouter price is available in this mode. Choose AA listed to use the source-listed rate when available.",

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
  const lines: TooltipLine[] = [
    { label: "Intelligence Index", value: record.intelligenceIndex.toFixed(1) },
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
