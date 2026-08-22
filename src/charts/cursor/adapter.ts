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

/** Seven model families requested for the initial Cursor view. */
export const CURSOR_DEFAULT_MODEL_GROUPS = [
  "opus-5",
  "grok-4-6",
  "luna",
  "sol",
  "terra",
  "fable-5",
  "composer-2-5",
] as const;

// These are the families already present in the current feed. Any family not
// in this baseline is treated as newly ingested and is visible implicitly.
const CURSOR_KNOWN_MODEL_GROUPS = new Set([
  ...CURSOR_DEFAULT_MODEL_GROUPS,
  "opus-4-8",
  "sonnet-5",
  "gemini-3-6-flash",
  "gemini-3-7-flash",
  "kimi-k3",
  "glm-5-2",
  "glm-5-3",
]);

/** Families intentionally omitted from the initial Cursor view. */
export function isCursorHiddenDefaultGroup(groupKey: string): boolean {
  return groupKey === "kimi-k3" || groupKey.startsWith("kimi-") ||
    groupKey === "gemini-3-6-flash" ||
    groupKey.startsWith("glm-");
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
  description:
    "Estimate Cursor's flat third-party-model fee from published cost, completion tokens, and a neutral logarithmic blend of valid input, cache-read, and cache-write rates; first-party Cursor models are exempt.",
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
    "Neutral Token mix assumption: a logarithmic blend across valid input, cache-read, and cache-write rates; 0% is Cache-heavy, 50% is neutral, and 100% is Input/write-heavy. This is not a measured cache-hit percentage.",
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
  identity: (record) => ({ id: record.modelId, label: modelDisplayMetadata(record.modelName, record.modelId).label }),
  defaultSelectionIds: (records) => cursorDefaultVisibleIds(records),
  computePoint: (record, controls): PlottablePoint | null => {
    const includeTokenRate = Boolean(controls[SURCHARGE_CONTROL_ID] ?? SURCHARGE_CONTROL.default);
    const cost = effectiveCursorCostUsd(record, includeTokenRate, tokenMixFromControls(controls));
    if (cost === null) return null;
    const metadata = modelDisplayMetadata(record.modelName, record.modelId);
    return {
      id: record.modelId,
      label: metadata.label,
      selectionLabel: record.modelName,
      brand: inferModelBrand(record.modelName, record.provider, record.modelId),
      effortGroup: metadata.groupKey,
      ...(metadata.effort ? { effort: metadata.effort } : {}),
      x: cost,
      y: record.score,
    };
  },
  searchText: (record) => `${record.modelName} ${record.provider} ${record.modelId}`,
  unplottableLabel: () => "no published price",
  unplottableDescription: () =>
    "This model has no valid published task cost, so it cannot be plotted.",
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
    // Detailed estimate lines below include the fee, so do not repeat it with
    // the concise surcharge line.
    lines.push(...cursorEstimateTooltipLines(record, controls));
    return lines;
  },
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
      value: "Estimate unavailable; published cost unchanged (output cost may exceed published cost, or completion tokens/rates are missing or invalid)",
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
        value: "Estimate unavailable; published cost unchanged (output cost may exceed published cost, or completion tokens/rates are missing or invalid)",
      },
    ];
  }
  const rate = blendCursorNonOutputPrice(profile, tokenMixPercent);
  if (rate === null) return [{
    label: "Cursor Token Rate",
    value: "Estimate unavailable; published cost unchanged (invalid Token mix assumption)",
  }];
  return [
    { label: "Token mix assumption", value: `${Math.round(tokenMixPercent)}% neutral logarithmic blend (Cache-heavy → Input/write-heavy)` },
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
