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

const SURCHARGE_CONTROL = {
  kind: "toggle",
  id: SURCHARGE_CONTROL_ID,
  label: `Third-party surcharge ($${CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS}/M tok)`,
  default: false,
  description:
    "Adds Cursor's flat third-party-model surcharge to the published cost of third-party models.",
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
): number | null {
  const base = record.publishedCostUsd;
  if (base === undefined || !Number.isFinite(base)) return null;
  let cost = base;
  if (includeSurcharge && record.isThirdParty) {
    const tokens = surchargeTokenVolume(record);
    if (tokens !== null) {
      cost += computeThirdPartySurchargeUsd(tokens, CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS);
    }
  }
  if (!Number.isFinite(cost) || cost <= 0) return null;
  return cost;
}

/** Formats a USD cost for tooltips and axis-adjacent labels. */
export function formatCursorCostUsd(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

export const cursorBenchAdapter: BenchmarkChartAdapter<DerivedCursorChartRecord> = {
  benchmarkId: CURSOR_BENCH_ID,
  xAxisLabel: "Avg cost per task (USD, cursor.com/evals)",
  yAxisLabel: "CursorBench score",
  defaultXScale: "log",
  controlSpecs: [SURCHARGE_CONTROL],
  identity: (record) => ({ id: record.modelId, label: record.modelName }),
  computePoint: (record, controls): PlottablePoint | null => {
    const cost = effectiveCursorCostUsd(
      record,
      Boolean(controls[SURCHARGE_CONTROL_ID] ?? SURCHARGE_CONTROL.default),
    );
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
      lines.push({ label: "Tokens / task", value: record.tokensPerTask.toLocaleString("en-US") });
    }
    lines.push({ label: "Provider", value: record.provider });
    return lines;
  },
  disclaimer:
    "Scores and per-task costs are published by cursor.com/evals. The optional third-party surcharge ($0.25 per million tokens) is a UI estimate applied on top of published costs — it is never part of the scraped data.",
};

/**
 * Surcharge line for the tooltip when it is actually included, so the
 * tooltip can state exactly how much of the cost is the surcharge.
 */
export function surchargeTooltipLine(
  record: DerivedCursorChartRecord,
  controls: Readonly<PricingControlState>,
): TooltipLine | null {
  if (!surchargeApplies(record, controls)) return null;
  const tokens = surchargeTokenVolume(record)!;
  const amount = computeThirdPartySurchargeUsd(tokens, CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS);
  return { label: "Incl. surcharge", value: `+$${amount.toFixed(4)} (${CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS}/M tok)` };
}
