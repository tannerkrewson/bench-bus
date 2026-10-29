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
import { latestModelVersionIds, modelDisplayMetadata, modelReleaseFamilyKey } from "../modelMetadata";
import { paretoFrontier } from "../plotData";
import { cursorTokenRateExemption } from "../../collectors/cursor/policy";
import {
  blendCursorNonOutputPrice,
  cursorCompletionTokens,
  cursorTokenRateProfile,
  estimateCursorTokenRate,
} from "./pricing";

/**
 * CursorBench score-versus-cost adapter. The optional Cursor Token Rate fee is
 * estimated from published completion tokens and model rates; raw source data
 * is never mutated.
 */
export const CURSOR_BENCH_ID = "cursor";
export const SURCHARGE_CONTROL_ID = "surcharge";
export const CACHE_HIT_RATE_CONTROL_ID = "cacheHitRate";

/** Current comparison families; superseded releases remain opt-in. */
export const CURSOR_DEFAULT_MODEL_GROUPS = [
  "opus-5-5", "sonnet-5-5", "haiku-5-5", "grok-4-7",
  "gemini-4-argon", "deepseek-v4-1-flash-1017", "composer-2-5", "gpt-5-6-sol",
] as const;

const DEFAULT_RELEASE_FAMILIES = new Set(
  CURSOR_DEFAULT_MODEL_GROUPS.map((id) => modelReleaseFamilyKey("", id.replace(/-v(?=\d)/, "-"))),
);

export function cursorDefaultVisibleIds(
  records: readonly DerivedCursorChartRecord[],
  points?: readonly PlottablePoint[],
): string[] {
  const availablePoints = points ?? records.flatMap((record) => {
    const point = cursorBenchAdapter.computePoint(record, { surcharge: true, cacheHitRate: 90 });
    return point ? [point] : [];
  });
  const pointIds = new Set(availablePoints.map((point) => point.id));
  // New discoveries need verified pricing before entering the implicit view.
  // Explicit URL/selector choices still win.
  const eligible = records.filter((record) =>
    pointIds.has(record.modelId) &&
    (cursorTokenRateExemption(record.modelId) !== null || cursorTokenRateProfile(record) !== null),
  );
  const latestIds = new Set(latestModelVersionIds(
    eligible.map((record) => ({
      id: record.modelId, label: modelDisplayMetadata(record.modelName, record.modelId).label,
    })),
    eligible.map((record) => record.modelId),
  ));
  const frontierIds = new Set(paretoFrontier(
    availablePoints.filter((point) => latestIds.has(point.id)),
  ).map((point) => point.id));
  return eligible.filter((record) =>
    latestIds.has(record.modelId) &&
    (DEFAULT_RELEASE_FAMILIES.has(modelReleaseFamilyKey(record.modelName, record.modelId)) ||
      frontierIds.has(record.modelId)),
  ).map((record) => record.modelId);
}

const SURCHARGE_CONTROL = {
  kind: "toggle",
  id: SURCHARGE_CONTROL_ID,
  label: `Include Cursor Token Rate ($${CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS}/M tok)`,
  default: true,
  description: "Estimate Cursor's Teams/Enterprise fee for eligible third-party models. Cursor models and explicitly excluded releases (including Haiku 5.5) are exempt.",
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
  if (!record.isThirdParty || cursorTokenRateExemption(record.modelId) !== null) return false;
  return estimateCursorTokenRate(record, cacheHitRateFromControls(controls)) !== null;
}

export function effectiveCursorCostUsd(
  record: DerivedCursorChartRecord,
  includeSurcharge: boolean,
  cacheHitRatePercent?: number,
): number | null {
  const base = record.publishedCostUsd;
  if (base === undefined || !Number.isFinite(base) || base <= 0) return null;
  if (includeSurcharge && record.isThirdParty && cursorTokenRateExemption(record.modelId) === null) {
    const estimate = estimateCursorTokenRate(record, cacheHitRatePercent ?? CACHE_HIT_RATE_CONTROL.default);
    return estimate?.adjustedCostUsd ?? null;
  }
  return base;
}

export function formatCursorCostUsd(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

export const cursorBenchAdapter: BenchmarkChartAdapter<DerivedCursorChartRecord> = {
  benchmarkId: CURSOR_BENCH_ID,
  title: "Best value models on Cursor",
  subtitle: "",
  sourceLinks: [
    { label: "CursorBench", href: "https://cursor.com/evals" },
    { label: "Cursor pricing & fee policy", href: "https://cursor.com/docs/models-and-pricing#cursor-token-rate" },
  ],
  xAxisLabel: "Avg cost per task (USD, cursor.com/evals)",
  yAxisLabel: "CursorBench score",
  defaultXScale: "log",
  controlSpecs: [SURCHARGE_CONTROL, CACHE_HIT_RATE_CONTROL],
  identity: (record) => ({ id: record.modelId, label: modelDisplayMetadata(record.modelName, record.modelId).label }),
  defaultSelectionIds: (records, points) => cursorDefaultVisibleIds(records, points),
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
  unplottableLabel: (controls) => controls.surcharge === false ? "no published price" : "no fee-inclusive price",
  unplottableDescription: () => "No valid fee-inclusive cost is available. Turn off the third-party fee to inspect published costs; missing rate/token data is not an exemption.",
  summaryTooltipLines: (record, point, controls): readonly TooltipLine[] => {
    const fee = surchargeTooltipLine(record, controls) ?? cursorEstimateTooltipLines(record, controls)[0];
    return [
      { label: "CursorBench score", value: `${record.score.toFixed(1)}%` },
      { label: "Avg cost / task", value: formatCursorCostUsd(point.x) },
      ...(fee ? [fee] : []),
    ];
  },
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
      !record.isThirdParty || cursorTokenRateExemption(record.modelId) !== null) return null;
  const estimate = estimateCursorTokenRate(record, cacheHitRateFromControls(controls));
  if (estimate === null) {
    return { label: "Cursor Token Rate", value: "Estimate unavailable; omitted while fee is enabled (output cost may exceed published cost, or completion tokens/rates are missing or invalid)" };
  }
  return {
    label: "Cursor Token Rate fee (estimate)",
    value: `+$${estimate.surchargeUsd.toFixed(4)}; ${estimate.totalTokens.toLocaleString("en-US", { maximumFractionDigits: 0 })} total processed tok; adjusted ${formatCursorCostUsd(estimate.adjustedCostUsd)}`,
  };
}

export function cursorEstimateTooltipLines(record: DerivedCursorChartRecord, controls: Readonly<PricingControlState>): readonly TooltipLine[] {
  if (!Boolean(controls[SURCHARGE_CONTROL_ID] ?? SURCHARGE_CONTROL.default)) return [];
  const exemption = cursorTokenRateExemption(record.modelId);
  if (!record.isThirdParty || exemption === "cursor-model") {
    return [{ label: "Cursor Token Rate", value: "Exempt (Cursor Models are first-party)" }];
  }
  if (exemption === "excluded-model") {
    return [{ label: "Cursor Token Rate", value: "Exempt (explicitly excluded by Cursor's published Token Rate policy)" }];
  }
  const cacheHitRatePercent = cacheHitRateFromControls(controls);
  const profile = cursorTokenRateProfile(record);
  const estimate = estimateCursorTokenRate(record, cacheHitRatePercent);
  if (estimate === null || profile === null) {
    return [{ label: "Cursor Token Rate", value: "Estimate unavailable; omitted while fee is enabled (output cost may exceed published cost, or completion tokens/rates are missing or invalid)" }];
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
