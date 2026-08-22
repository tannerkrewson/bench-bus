import type { DerivedAaChartRecord } from "../../schemas";
import type {
  BenchmarkChartAdapter,
  PlottablePoint,
  PricingControlState,
  TooltipLine,
  PriceDiscountAnnotation,
} from "../types";
import { inferModelBrand } from "../brand";
import { modelDisplayMetadata } from "../modelMetadata";
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

function providerDiscountAnnotation(
  provider: DerivedAaChartRecord["providers"][number],
  inputTokens: number,
  outputTokens: number,
  plottedCost?: number,
): PriceDiscountAnnotation | undefined {
  const percentage = provider.discountPercentage;
  if (percentage === undefined || percentage <= 0 || percentage >= 100) return undefined;
  const effectiveX =
    (inputTokens / 1e6) * provider.effectiveInputPrice +
    (outputTokens / 1e6) * provider.effectiveOutputPrice;
  if (!Number.isFinite(effectiveX) || effectiveX <= 0) return undefined;
  const listedInput = provider.listedInputPrice;
  const listedOutput = provider.listedOutputPrice;
  const preDiscountX =
    listedInput !== undefined && listedOutput !== undefined && listedInput > 0 && listedOutput > 0
      ? (inputTokens / 1e6) * listedInput + (outputTokens / 1e6) * listedOutput
      : effectiveX / (1 - percentage / 100);
  // The percentage is explicit OpenRouter metadata. If provider-level listed
  // rates are present, they are used directly; otherwise the undiscounted
  // workload cost is recovered from that explicit percentage and the same
  // provider's effective workload cost.
  if (!Number.isFinite(preDiscountX) || preDiscountX <= effectiveX) return undefined;
  const tolerance = plottedCost === undefined ? 0 : Math.max(0.005, Math.abs(plottedCost) * 1e-6);
  return {
    percentage,
    preDiscountX,
    effectiveX,
    providerName: provider.providerName,
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
  };
}

function explicitProviderDiscounts(
  record: DerivedAaChartRecord,
  plottedCost: number,
): PriceDiscountAnnotation[] {
  return record.providers.flatMap((provider) => {
    const annotation = providerDiscountAnnotation(
      provider,
      record.canonicalTokens.input,
      record.canonicalTokens.output,
      plottedCost,
    );
    return annotation ? [annotation] : [];
  });
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

  identity: (record) => ({ id: record.slug, label: modelDisplayMetadata(record.name, record.slug).label }),

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
    const metadata = modelDisplayMetadata(record.name, record.slug);
    return {
      id: record.slug,
      label: metadata.label,
      selectionLabel: record.name,
      brand: inferModelBrand(record.name, record.slug),
      effortGroup: metadata.groupKey,
      x: cost,
      y: record.intelligenceIndex,
      ...(discount ? { discount } : {}),
      ...(mode === "cheapest"
        ? { discounts: explicitProviderDiscounts(record, cost) }
        : {}),
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
