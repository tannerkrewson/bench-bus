import {
  CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS,
  type DerivedCursorChartRecord,
} from "../../schemas";
import type {
  BenchmarkChartAdapter,
  PlottablePoint,
  PricingControlState,
  TooltipLine,
} from "../types";
import { inferModelBrand } from "../brand";
import { modelDisplayMetadata } from "../modelMetadata";
import {
  blendCursorNonOutputPrice,
  cursorCompletionTokens,
  cursorTokenRateProfile,
  estimateCursorTokenRate,
  isCursorFirstPartyModel,
} from "./pricing";

/**
 * CursorBench score-versus-cost adapter. The optional Cursor Token Rate fee is
 * estimated from published completion tokens and model rates; raw source data
 * is never mutated.
 */
export const CURSOR_BENCH_ID = "cursor";
export const SURCHARGE_CONTROL_ID = "surcharge";
export const CACHE_HIT_RATE_CONTROL_ID = "cacheHitRate";

export const CURSOR_DEFAULT_MODEL_GROUPS = [
  "opus-5", "grok-4-6", "luna", "sol", "terra", "fable-5", "composer-2-5",
] as const;

const CURSOR_KNOWN_MODEL_GROUPS = new Set([
  ...CURSOR_DEFAULT_MODEL_GROUPS,
  "opus-4-8", "sonnet-5", "gemini-3-6-flash", "gemini-3-7-flash", "kimi-k3", "glm-5-2", "glm-5-3",
]);

export function isCursorHiddenDefaultGroup(groupKey: string): boolean {
  return groupKey === "kimi-k3" || groupKey.startsWith("kimi-") ||
    groupKey === "gemini-3-6-flash" || groupKey.startsWith("glm-");
}

export function cursorDefaultVisibleIds(records: readonly DerivedCursorChartRecord[]): string[] {
  return records
    .filter((record) => {
      const groupKey = modelDisplayMetadata(record.modelName, record.modelId).groupKey;
      return !isCursorHiddenDefaultGroup(groupKey) &&
        (CURSOR_DEFAULT_MODEL_GROUPS.includes(groupKey as (typeof CURSOR_DEFAULT_MODEL_GROUPS)[number]) ||
          !CURSOR_KNOWN_MODEL_GROUPS.has(groupKey));
    })
    .map((record) => record.modelId);
}

const SURCHARGE_CONTROL = {
  kind: "toggle",
  id: SURCHARGE_CONTROL_ID,
  label: `Include Cursor Token Rate ($${CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS}/M tok)`,
  default: false,
  description: "Estimate Cursor's flat third-party-model fee from published cost, completion tokens, and an estimated cache-hit rate; Cursor Models are exempt.",
} as const;

const CACHE_HIT_RATE_CONTROL = {
  kind: "slider",
  id: CACHE_HIT_RATE_CONTROL_ID,
  label: "Estimated cache hit rate",
  default: 90,
  min: 0,
  max: 100,
  step: 1,
  format: (value: number) => `${Math.round(value)}%`,
  description: "Percentage of non-output prompt tokens assumed to be served from cache. Higher cache reuse implies more total processed tokens for the same published model cost, and therefore a larger Cursor Token Rate.",
} as const;

export function completionTokensForCursorRate(record: DerivedCursorChartRecord): number | null {
  return cursorCompletionTokens(record);
}

function cacheHitRateFromControls(controls: Readonly<PricingControlState>): number {
  const rawRate = controls[CACHE_HIT_RATE_CONTROL_ID];
  return typeof rawRate === "number" && Number.isFinite(rawRate) ? rawRate : CACHE_HIT_RATE_CONTROL.default;
}

export function surchargeApplies(record: DerivedCursorChartRecord, controls: Readonly<PricingControlState>): boolean {
  if (!Boolean(controls[SURCHARGE_CONTROL_ID] ?? SURCHARGE_CONTROL.default)) return false;
  if (!record.isThirdParty || isCursorFirstPartyModel(record.modelId)) return false;
  return estimateCursorTokenRate(record, cacheHitRateFromControls(controls)) !== null;
}

export function effectiveCursorCostUsd(
  record: DerivedCursorChartRecord,
  includeSurcharge: boolean,
  cacheHitRatePercent?: number,
): number | null {
  const base = record.publishedCostUsd;
  if (base === undefined || !Number.isFinite(base) || base <= 0) return null;
  if (includeSurcharge && record.isThirdParty && !isCursorFirstPartyModel(record.modelId)) {
    const estimate = estimateCursorTokenRate(record, cacheHitRatePercent ?? CACHE_HIT_RATE_CONTROL.default);
    if (estimate !== null) return estimate.adjustedCostUsd;
  }
  return base;
}

export function formatCursorCostUsd(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

export const cursorBenchAdapter: BenchmarkChartAdapter<DerivedCursorChartRecord> = {
  benchmarkId: CURSOR_BENCH_ID,
  title: "Best value models on Cursor",
  subtitle: "CursorBench score versus average benchmark workload cost per task from cursor.com/evals.",
  xAxisLabel: "Avg cost per task (USD, cursor.com/evals)",
  yAxisLabel: "CursorBench score",
  defaultXScale: "log",
  controlSpecs: [SURCHARGE_CONTROL, CACHE_HIT_RATE_CONTROL],
  identity: (record) => ({ id: record.modelId, label: modelDisplayMetadata(record.modelName, record.modelId).label }),
  defaultSelectionIds: (records) => cursorDefaultVisibleIds(records),
  computePoint: (record, controls): PlottablePoint | null => {
    const includeTokenRate = Boolean(controls[SURCHARGE_CONTROL_ID] ?? SURCHARGE_CONTROL.default);
    const cost = effectiveCursorCostUsd(record, includeTokenRate, cacheHitRateFromControls(controls));
    if (cost === null) return null;
    const metadata = modelDisplayMetadata(record.modelName, record.modelId);
    return {
      id: record.modelId,
      label: metadata.label,
      selectionLabel: record.modelName.includes("(") ? metadata.label : record.modelName,
      brand: inferModelBrand(record.modelName, record.provider, record.modelId),
      effortGroup: metadata.groupKey,
      ...(metadata.effort ? { effort: metadata.effort } : {}),
      x: cost,
      y: record.score,
    };
  },
  searchText: (record) => `${record.modelName} ${record.provider} ${record.modelId}`,
  unplottableLabel: () => "no published price",
  unplottableDescription: () => "This model has no valid published task cost, so it cannot be plotted.",
  tooltipLines: (record, point, controls): readonly TooltipLine[] => {
    const lines: TooltipLine[] = [
      { label: "CursorBench score", value: `${record.score.toFixed(1)}%` },
      { label: "Avg cost / task", value: formatCursorCostUsd(point.x) },
    ];
    if (record.tokensPerTask !== undefined && Number.isFinite(record.tokensPerTask)) {
      lines.push({ label: "Completion tokens / task (published)", value: record.tokensPerTask.toLocaleString("en-US") });
    } else if (record.outputTokens !== undefined && Number.isFinite(record.outputTokens)) {
      lines.push({ label: "Completion tokens / task", value: record.outputTokens.toLocaleString("en-US") });
    }
    lines.push({ label: "Published cost / task", value: record.publishedCostUsd !== undefined ? formatCursorCostUsd(record.publishedCostUsd) : "Unavailable" });
    lines.push({ label: "Provider", value: record.provider });
    lines.push(...cursorEstimateTooltipLines(record, controls));
    return lines;
  },
};

export function surchargeTooltipLine(record: DerivedCursorChartRecord, controls: Readonly<PricingControlState>): TooltipLine | null {
  if (!Boolean(controls[SURCHARGE_CONTROL_ID] ?? SURCHARGE_CONTROL.default) ||
      !record.isThirdParty || isCursorFirstPartyModel(record.modelId)) return null;
  const estimate = estimateCursorTokenRate(record, cacheHitRateFromControls(controls));
  if (estimate === null) {
    return { label: "Cursor Token Rate", value: "Estimate unavailable; published cost unchanged (output cost may exceed published cost, or completion tokens/rates are missing or invalid)" };
  }
  return {
    label: "Cursor Token Rate fee (estimate)",
    value: `+$${estimate.surchargeUsd.toFixed(4)}; ${estimate.totalTokens.toLocaleString("en-US", { maximumFractionDigits: 0 })} total processed tok; adjusted ${formatCursorCostUsd(estimate.adjustedCostUsd)}`,
  };
}

export function cursorEstimateTooltipLines(record: DerivedCursorChartRecord, controls: Readonly<PricingControlState>): readonly TooltipLine[] {
  if (!Boolean(controls[SURCHARGE_CONTROL_ID] ?? SURCHARGE_CONTROL.default)) return [];
  if (!record.isThirdParty || isCursorFirstPartyModel(record.modelId)) {
    return [{ label: "Cursor Token Rate", value: "Exempt (Cursor Models are first-party)" }];
  }
  const cacheHitRatePercent = cacheHitRateFromControls(controls);
  const profile = cursorTokenRateProfile(record);
  const estimate = estimateCursorTokenRate(record, cacheHitRatePercent);
  if (estimate === null || profile === null) {
    return [{ label: "Cursor Token Rate", value: "Estimate unavailable; published cost unchanged (output cost may exceed published cost, or completion tokens/rates are missing or invalid)" }];
  }
  const rate = blendCursorNonOutputPrice(profile, cacheHitRatePercent);
  if (rate === null) return [{ label: "Cursor Token Rate", value: "Estimate unavailable; published cost unchanged (invalid estimated cache hit rate)" }];
  return [
    { label: "Estimated cache hit rate", value: `${Math.round(cacheHitRatePercent)}%` },
    { label: "Published cost / task", value: formatCursorCostUsd(record.publishedCostUsd!) },
    { label: "Completion tokens", value: estimate.completionTokens.toLocaleString("en-US") },
    { label: "Blended non-output rate (estimate)", value: `$${rate.toFixed(4)}/M` },
    { label: "Non-cached rate", value: `$${estimate.nonCachedRateUsdPerMillion.toFixed(4)}/M` },
    { label: "Output cost subtracted", value: `$${estimate.outputCostUsd.toFixed(4)}` },
    { label: "Residual non-output cost", value: `$${estimate.residualNonOutputCostUsd.toFixed(4)}` },
    { label: "Hidden non-output tokens (estimate)", value: estimate.hiddenTokens.toLocaleString("en-US", { maximumFractionDigits: 0 }) },
    { label: "Total processed tokens (estimate)", value: estimate.totalTokens.toLocaleString("en-US", { maximumFractionDigits: 0 }) },
    { label: "Cursor Token Rate fee", value: `+$${estimate.surchargeUsd.toFixed(4)}` },
    { label: "Adjusted cost", value: formatCursorCostUsd(estimate.adjustedCostUsd) },
    { label: "Uncertainty at selected cache hit rate", value: `$${estimate.surchargeRangeUsd[0].toFixed(4)}–$${estimate.surchargeRangeUsd[1].toFixed(4)} fee; ${estimate.adjustedCostRangeUsd[0].toFixed(2)}–$${estimate.adjustedCostRangeUsd[1].toFixed(2)} adjusted cost` },
  ];
}
