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
  cursorCompletionTokens,
  cursorTokenRateProfile,
  estimateCursorTokenRate,
} from "./pricing";

/**
 * Real CursorBench adapter (bench-bus-0cd.11).
 *
 * X is the benchmark workload cost published by cursor.com/evals — the
 * source table's real per-task cost. The only derived adjustment is Cursor's
 * optional flat $0.25 per million tokens surcharge for third-party models,
 * estimated from published completion tokens and model rates.
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
    "Estimate Cursor's flat third-party-model fee from published cost, completion tokens, and published model rates; first-party Cursor models are exempt.",
} as const;

const TOKEN_MIX_CONTROL = {
  kind: "slider",
  id: TOKEN_MIX_CONTROL_ID,
  // Keep the tokenMix id so existing chart.cursor URLs remain readable.
  label: "Token mix assumption",
  default: 50,
  min: 0,
  max: 100,
  step: 1,
  format: (value: number) => `${Math.round(value)}%`,
  description:
    "Assumed non-output mix: 0% Cache-heavy (cheapest rate), 50% neutral estimate, 100% Input/write-heavy (most expensive rate). This is not a measured cache ratio.",
} as const;

/** Completion/output tokens published by CursorBench, never total tokens. */
export function completionTokensForCursorRate(record: DerivedCursorChartRecord): number | null {
  return cursorCompletionTokens(record);
}

/** True when an enabled, rate-backed surcharge estimate contributes to a point. */
export function surchargeApplies(
  record: DerivedCursorChartRecord,
  controls: Readonly<PricingControlState>,
): boolean {
  if (!Boolean(controls[SURCHARGE_CONTROL_ID] ?? SURCHARGE_CONTROL.default)) return false;
  if (!record.isThirdParty) return false;
  return estimateCursorTokenRate(record, tokenMixFromControls(controls)) !== null;
}

/**
 * Effective plotted cost for one record under the surcharge toggle. A
 * third-party row lacking published completion/output tokens or usable rates
 * remains at its published cost; it is never charged from completion tokens
 * alone.
 */
export function effectiveCursorCostUsd(
  record: DerivedCursorChartRecord,
  includeSurcharge: boolean,
  tokenMixPercent?: number,
): number | null {
  const base = record.publishedCostUsd;
  if (base === undefined || !Number.isFinite(base) || base <= 0) return null;
  if (includeSurcharge && record.isThirdParty) {
    const estimate = estimateCursorTokenRate(record, tokenMixPercent ?? TOKEN_MIX_CONTROL.default);
    if (estimate !== null) return estimate.adjustedCostUsd;
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
    const cost = effectiveCursorCostUsd(record, includeTokenRate, tokenMixFromControls(controls));
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
    if (record.tokensPerTask !== undefined && Number.isFinite(record.tokensPerTask)) {
      lines.push({
        label: "Completion tokens / task (published)",
        value: record.tokensPerTask.toLocaleString("en-US"),
      });
    } else if (record.outputTokens !== undefined && Number.isFinite(record.outputTokens)) {
      lines.push({
        label: "Completion tokens / task",
        value: record.outputTokens.toLocaleString("en-US"),
      });
    }
    lines.push({
      label: "Published cost / task",
      value: record.publishedCostUsd !== undefined ? formatCursorCostUsd(record.publishedCostUsd) : "Unavailable",
    });
    lines.push({ label: "Provider", value: record.provider });
    const surchargeLine = surchargeTooltipLine(record, controls);
    if (surchargeLine) lines.push(surchargeLine);
    lines.push(...cursorEstimateTooltipLines(record, controls));
    return lines;
  },
  disclaimer:
    "Scores, costs, and completion tokens are published by cursor.com/evals. Cursor Token Rate is an estimate: it subtracts known completion cost, then infers hidden non-output tokens from published model rates at the selected Token mix assumption. Raw source values are never mutated; first-party Cursor models are exempt.",
};

function tokenMixFromControls(controls: Readonly<PricingControlState>): number {
  const rawTokenMix = controls[TOKEN_MIX_CONTROL_ID];
  return typeof rawTokenMix === "number" && Number.isFinite(rawTokenMix)
    ? rawTokenMix
    : TOKEN_MIX_CONTROL.default;
}

/** Surcharge line for the tooltip when a rate-backed estimate is included. */
export function surchargeTooltipLine(
  record: DerivedCursorChartRecord,
  controls: Readonly<PricingControlState>,
): TooltipLine | null {
  if (!Boolean(controls[SURCHARGE_CONTROL_ID] ?? SURCHARGE_CONTROL.default) || !record.isThirdParty) {
    return null;
  }
  const estimate = estimateCursorTokenRate(record, tokenMixFromControls(controls));
  if (estimate === null) {
    return {
      label: "Cursor Token Rate",
      value: "Estimate unavailable; published cost unchanged (completion tokens and published rates required)",
    };
  }
  return {
    label: "Cursor Token Rate fee (estimate)",
    value: `+$${estimate.surchargeUsd.toFixed(4)}; ${estimate.totalTokens.toLocaleString("en-US", { maximumFractionDigits: 0 })} total processed tok; adjusted ${formatCursorCostUsd(estimate.adjustedCostUsd)}`,
  };
}

/** All per-point assumptions and uncertainty details shown in the tooltip. */
export function cursorEstimateTooltipLines(
  record: DerivedCursorChartRecord,
  controls: Readonly<PricingControlState>,
): readonly TooltipLine[] {
  if (!Boolean(controls[SURCHARGE_CONTROL_ID] ?? SURCHARGE_CONTROL.default)) return [];
  if (!record.isThirdParty) return [{ label: "Cursor Token Rate", value: "Exempt (first-party Cursor model)" }];

  const tokenMixPercent = tokenMixFromControls(controls);
  const profile = cursorTokenRateProfile(record);
  const estimate = estimateCursorTokenRate(record, tokenMixPercent);
  if (estimate === null || profile === null) {
    return [
      {
        label: "Cursor Token Rate",
        value: "Estimate unavailable; published cost unchanged (completion tokens and published rates required)",
      },
    ];
  }
  const rate = blendCursorNonOutputPrice(profile, tokenMixPercent);
  if (rate === null) return [{ label: "Cursor Token Rate", value: "Estimate unavailable; published cost unchanged" }];
  return [
    { label: "Token mix assumption", value: `${Math.round(tokenMixPercent)}% (Cache-heavy → Input/write-heavy)` },
    { label: "Published cost / task", value: formatCursorCostUsd(record.publishedCostUsd!) },
    { label: "Completion tokens", value: estimate.completionTokens.toLocaleString("en-US") },
    { label: "Blended non-output rate (estimate)", value: `$${rate.toFixed(4)}/M` },
    { label: "Output cost subtracted", value: `$${estimate.outputCostUsd.toFixed(4)}` },
    { label: "Residual non-output cost", value: `$${estimate.residualNonOutputCostUsd.toFixed(4)}` },
    { label: "Hidden non-output tokens (estimate)", value: estimate.hiddenTokens.toLocaleString("en-US", { maximumFractionDigits: 0 }) },
    { label: "Total processed tokens (estimate)", value: estimate.totalTokens.toLocaleString("en-US", { maximumFractionDigits: 0 }) },
    { label: "Cursor Token Rate fee", value: `+$${estimate.surchargeUsd.toFixed(4)}` },
    { label: "Adjusted cost", value: formatCursorCostUsd(estimate.adjustedCostUsd) },
    { label: "Possible fee range", value: `$${estimate.surchargeRangeUsd[0].toFixed(4)}–$${estimate.surchargeRangeUsd[1].toFixed(4)}` },
    { label: "Possible adjusted cost", value: `$${estimate.adjustedCostRangeUsd[0].toFixed(2)}–$${estimate.adjustedCostRangeUsd[1].toFixed(2)}` },
  ];
}
