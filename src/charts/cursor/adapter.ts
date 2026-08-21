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
  label: "Cache-heavy to Input-heavy",
  default: 50,
  min: 0,
  max: 100,
  step: 1,
  format: (value: number) => `${Math.round(value)}%`,
  description:
    "Estimate only: 0% cache-heavy · 50% neutral (not typical) · 100% input-heavy. Lower blended rates imply more hidden tokens and a larger fee.",
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
  tokenMixPercent?: number,
): number | null {
  const base = record.publishedCostUsd;
  if (base === undefined || !Number.isFinite(base)) return null;
  if (includeSurcharge && tokenMixPercent !== undefined) {
    const estimate = estimateCursorTokenRate(record, tokenMixPercent);
    // Missing/invalid source inputs remain at the raw published cost rather
    // than being replaced by a guessed token volume.
    if (estimate !== null) return estimate.adjustedCostUsd;
    if (record.isThirdParty) return base;
  } else if (includeSurcharge && record.isThirdParty) {
    // Compatibility path for callers using the original aggregate-token
    // surcharge API. The chart UI always supplies the token-mix position.
    const tokens = surchargeTokenVolume(record);
    if (tokens !== null) {
      return base + computeThirdPartySurchargeUsd(tokens, CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS);
    }
  }
  if (!Number.isFinite(base) || base <= 0) return null;
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
    const rawTokenMix = controls[TOKEN_MIX_CONTROL_ID];
    const tokenMix = typeof rawTokenMix === "number" ? rawTokenMix : undefined;
    const cost = effectiveCursorCostUsd(record, includeTokenRate, tokenMix);
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
  tooltipLines: (record, point): readonly TooltipLine[] => {
    const lines: TooltipLine[] = [
      { label: "CursorBench score", value: `${record.score.toFixed(1)}%` },
      { label: "Avg cost / task", value: formatCursorCostUsd(point.x) },
    ];
    if (record.tokensPerTask !== undefined) {
      lines.push({ label: "Tokens / task (published)", value: record.tokensPerTask.toLocaleString("en-US") });
    }
    lines.push({ label: "Provider", value: record.provider });
    return lines;
  },
  disclaimer:
    "Scores, costs, and aggregate tokens are published by cursor.com/evals. Cursor Token Rate is an estimate: it subtracts known output cost, then infers hidden tokens from model-specific rates. Raw source values are never mutated.",
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
  const tokenMix = Number(controls[TOKEN_MIX_CONTROL_ID]);
  if (Number.isFinite(tokenMix)) {
    const estimate = estimateCursorTokenRate(record, tokenMix);
    if (estimate !== null) {
      return {
        label: "Cursor Token Rate fee (estimate)",
        value: `+$${estimate.surchargeUsd.toFixed(4)}; ${estimate.totalTokens.toLocaleString("en-US", { maximumFractionDigits: 0 })} total tok`,
      };
    }
    return null;
  }
  if (!surchargeApplies(record, controls)) return null;
  const tokens = surchargeTokenVolume(record)!;
  const amount = computeThirdPartySurchargeUsd(tokens, CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS);
  return { label: "Incl. surcharge", value: `+$${amount.toFixed(4)} (${CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS}/M tok)` };
}

/** All per-point assumptions and uncertainty details shown in the tooltip. */
export function cursorEstimateTooltipLines(
  record: DerivedCursorChartRecord,
  controls: Readonly<PricingControlState>,
): readonly TooltipLine[] {
  if (!Boolean(controls[SURCHARGE_CONTROL_ID] ?? SURCHARGE_CONTROL.default)) return [];
  if (!record.isThirdParty) return [{ label: "Cursor Token Rate", value: "Exempt (first-party Cursor model)" }];
  const tokenMix = Number(controls[TOKEN_MIX_CONTROL_ID]);
  if (!Number.isFinite(tokenMix)) return [];
  const profile = cursorTokenRateProfile(record);
  const estimate = estimateCursorTokenRate(record, tokenMix);
  if (profile === null || estimate === null) {
    return [{ label: "Cursor Token Rate", value: "Estimate unavailable for this model/source row" }];
  }
  const rate = blendCursorNonOutputPrice(profile, tokenMix)!;
  return [
    { label: "Blended non-output rate (estimate)", value: `$${rate.toFixed(4)}/M` },
    { label: "Hidden tokens (estimate)", value: estimate.hiddenTokens.toLocaleString("en-US", { maximumFractionDigits: 0 }) },
    { label: "Total tokens (estimate)", value: estimate.totalTokens.toLocaleString("en-US", { maximumFractionDigits: 0 }) },
    { label: "Output cost subtracted", value: `$${estimate.outputCostUsd.toFixed(4)}` },
    { label: "Possible fee range", value: `$${estimate.surchargeRangeUsd[0].toFixed(4)}–$${estimate.surchargeRangeUsd[1].toFixed(4)}` },
    { label: "Possible adjusted cost", value: `$${estimate.adjustedCostRangeUsd[0].toFixed(2)}–$${estimate.adjustedCostRangeUsd[1].toFixed(2)}` },
  ];
}
