import { computeThirdPartySurchargeUsd } from "../../collectors/cursor/surcharge";
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
import {
  blendCursorNonOutputPrice,
  cursorTokenRateProfile,
  estimateCursorTokenRate,
} from "./pricing";

/**
 * Real CursorBench adapter (bench-bus-0cd.11).
 *
 * X is the benchmark workload cost published by cursor.com/evals — the
 * source table's real per-task cost, never a hypothetical normalized
 * usage. The only derived adjustment is Cursor's optional flat $0.25 per
 * million tokens surcharge for third-party models, applied on top of the
 * published cost when the user enables it (never baked into raw values).
 */

export const CURSOR_BENCH_ID = "cursor";

export const SURCHARGE_CONTROL_ID = "surcharge";
export const TOKEN_MIX_CONTROL_ID = "tokenMix";

const SURCHARGE_CONTROL = {
  kind: "toggle",
  id: SURCHARGE_CONTROL_ID,
  label: `Include Cursor Token Rate ($${CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS}/M tok)`,
  default: false,
  description:
    "Estimate Cursor's flat third-party-model fee from published cost and known output tokens; first-party Cursor models are exempt.",
} as const;

const TOKEN_MIX_CONTROL = {
  kind: "slider",
  id: TOKEN_MIX_CONTROL_ID,
  // Keep the tokenMix id so existing chart.cursor URLs remain readable.
  label: "Cache hit rate",
  default: 90,
  min: 0,
  max: 100,
  step: 1,
  format: (value: number) => `${Math.round(value)}%`,
  description:
    "Estimate only: cached input tokens / total input tokens. 0% is fully input-priced; 100% is fully cache-priced.",
} as const;

/** Token volume the surcharge applies to: aggregate tokens per task. */
export function surchargeTokenVolume(record: DerivedCursorChartRecord): number | null {
  if (record.tokensPerTask !== undefined && Number.isFinite(record.tokensPerTask)) {
    return record.tokensPerTask;
  }
  // Fallback for records that somehow carry input/output splits instead of
  // the table's aggregate (real scraped rows only publish the aggregate).
  const { inputTokens, outputTokens } = record;
  if (
    inputTokens !== undefined &&
    outputTokens !== undefined &&
    Number.isFinite(inputTokens) &&
    Number.isFinite(outputTokens)
  ) {
    return inputTokens + outputTokens;
  }
  return null;
}

/** True when the surcharge contributes to this record's plotted cost. */
export function surchargeApplies(
  record: DerivedCursorChartRecord,
  controls: Readonly<PricingControlState>,
): boolean {
  return (
    Boolean(controls[SURCHARGE_CONTROL_ID] ?? SURCHARGE_CONTROL.default) &&
    record.isThirdParty &&
    surchargeTokenVolume(record) !== null
  );
}

/**
 * Effective plotted cost for one record under the surcharge toggle.
 * Returns null when the record is unplottable (no published cost, or a
 * non-positive/non-finite result) — never a guessed or zero price.
 */
export function effectiveCursorCostUsd(
  record: DerivedCursorChartRecord,
  includeSurcharge: boolean,
  cacheHitRatePercent?: number,
): number | null {
  const base = record.publishedCostUsd;
  if (base === undefined || !Number.isFinite(base) || base <= 0) return null;
  if (includeSurcharge && record.isThirdParty) {
    if (cacheHitRatePercent !== undefined) {
      const estimate = estimateCursorTokenRate(record, cacheHitRatePercent);
      if (estimate !== null) return estimate.adjustedCostUsd;
    }
    // Aggregate-only scraped rows have the real tokens/task figure but no
    // input/output split (and therefore cannot support the model-rate
    // estimate). Cursor's flat rate still applies to that published volume.
    const tokens = surchargeTokenVolume(record);
    if (tokens !== null) {
      const adjusted = base + computeThirdPartySurchargeUsd(tokens, CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS);
      return Number.isFinite(adjusted) && adjusted > 0 ? adjusted : null;
    }
  }
  return base;
}

/** Formats a USD cost for tooltips and axis-adjacent labels. */
export function formatCursorCostUsd(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

export const cursorBenchAdapter: BenchmarkChartAdapter<DerivedCursorChartRecord> = {
  benchmarkId: CURSOR_BENCH_ID,
  title: "Cursor coding model value",
  subtitle: "CursorBench score versus average benchmark workload cost per task from cursor.com/evals.",
  xAxisLabel: "Avg cost per task (USD, cursor.com/evals)",
  yAxisLabel: "CursorBench score",
  defaultXScale: "log",
  controlSpecs: [SURCHARGE_CONTROL, TOKEN_MIX_CONTROL],
  identity: (record) => ({ id: record.modelId, label: record.modelName }),
  computePoint: (record, controls): PlottablePoint | null => {
    const includeTokenRate = Boolean(controls[SURCHARGE_CONTROL_ID] ?? SURCHARGE_CONTROL.default);
    const rawCacheHitRate = controls[TOKEN_MIX_CONTROL_ID];
    const cacheHitRate = typeof rawCacheHitRate === "number" ? rawCacheHitRate : undefined;
    const cost = effectiveCursorCostUsd(record, includeTokenRate, cacheHitRate);
    if (cost === null) return null;
    return {
      id: record.modelId,
      label: record.modelName,
      brand: inferModelBrand(record.modelName, record.provider, record.modelId),
      x: cost,
      y: record.score,
    };
  },
  searchText: (record) => `${record.modelName} ${record.provider} ${record.modelId}`,
  tooltipLines: (record, point, controls): readonly TooltipLine[] => {
    const lines: TooltipLine[] = [
      { label: "CursorBench score", value: `${record.score.toFixed(1)}%` },
      { label: "Avg cost / task", value: formatCursorCostUsd(point.x) },
    ];
    if (record.tokensPerTask !== undefined) {
      lines.push({ label: "Tokens / task (published)", value: record.tokensPerTask.toLocaleString("en-US") });
    }
    lines.push({ label: "Provider", value: record.provider });
    const surchargeLine = surchargeTooltipLine(record, controls);
    if (surchargeLine) lines.push(surchargeLine);
    lines.push(...cursorEstimateTooltipLines(record, controls));
    return lines;
  },
};

/**
 * Surcharge line for the tooltip when it is actually included, so the
 * tooltip can state exactly how much of the cost is the surcharge.
 */
export function surchargeTooltipLine(
  record: DerivedCursorChartRecord,
  controls: Readonly<PricingControlState>,
): TooltipLine | null {
  const enabled = Boolean(controls[SURCHARGE_CONTROL_ID] ?? SURCHARGE_CONTROL.default);
  if (!enabled || !record.isThirdParty) return null;
  const cacheHitRate = Number(controls[TOKEN_MIX_CONTROL_ID]);
  if (Number.isFinite(cacheHitRate)) {
    const estimate = estimateCursorTokenRate(record, cacheHitRate);
    if (estimate !== null) {
      return {
        label: "Cursor Token Rate fee (estimate)",
        value: `+$${estimate.surchargeUsd.toFixed(4)}; ${estimate.totalTokens.toLocaleString("en-US", { maximumFractionDigits: 0 })} total tok`,
      };
    }
  }
  if (!surchargeApplies(record, controls)) return null;
  const tokens = surchargeTokenVolume(record)!;
  const amount = computeThirdPartySurchargeUsd(tokens, CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS);
  return {
    label: "Cursor Token Rate fee (aggregate fallback)",
    value: `+$${amount.toFixed(4)}; ${tokens.toLocaleString("en-US", { maximumFractionDigits: 0 })} aggregate tok × ${CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS}/M (estimation inputs unavailable)`,
  };
}

/** All per-point assumptions and uncertainty details shown in the tooltip. */
export function cursorEstimateTooltipLines(
  record: DerivedCursorChartRecord,
  controls: Readonly<PricingControlState>,
): readonly TooltipLine[] {
  if (!Boolean(controls[SURCHARGE_CONTROL_ID] ?? SURCHARGE_CONTROL.default)) return [];
  if (!record.isThirdParty) return [{ label: "Cursor Token Rate", value: "Exempt (first-party Cursor model)" }];
  const cacheHitRate = Number(controls[TOKEN_MIX_CONTROL_ID]);
  if (!Number.isFinite(cacheHitRate)) return [];
  const profile = cursorTokenRateProfile(record);
  const estimate = estimateCursorTokenRate(record, cacheHitRate);
  if (estimate === null) {
    const tokens = surchargeTokenVolume(record);
    if (tokens !== null) {
      return [
        {
          label: "Cursor Token Rate",
          value: `Aggregate fallback: published tokens/task × flat $${CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS}/M (estimation inputs unavailable)`,
        },
        { label: "Aggregate tokens (fallback)", value: tokens.toLocaleString("en-US") },
      ];
    }
    return [{ label: "Cursor Token Rate", value: "Estimate unavailable for this model/source row" }];
  }
  if (profile === null) {
    return [{ label: "Cursor Token Rate", value: "Estimate unavailable for this model/source row" }];
  }
  const rate = blendCursorNonOutputPrice(profile, cacheHitRate)!;
  return [
    { label: "Cache hit rate", value: `${Math.round(cacheHitRate)}% (cached input / total input)` },
    { label: "Blended non-output rate (estimate)", value: `$${rate.toFixed(4)}/M` },
    { label: "Hidden tokens (estimate)", value: estimate.hiddenTokens.toLocaleString("en-US", { maximumFractionDigits: 0 }) },
    { label: "Total tokens (estimate)", value: estimate.totalTokens.toLocaleString("en-US", { maximumFractionDigits: 0 }) },
    { label: "Output cost subtracted", value: `$${estimate.outputCostUsd.toFixed(4)}` },
    { label: "Possible fee range", value: `$${estimate.surchargeRangeUsd[0].toFixed(4)}–$${estimate.surchargeRangeUsd[1].toFixed(4)}` },
    { label: "Possible adjusted cost", value: `$${estimate.adjustedCostRangeUsd[0].toFixed(2)}–$${estimate.adjustedCostRangeUsd[1].toFixed(2)}` },
  ];
}
