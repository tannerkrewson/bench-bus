import type {
  BenchmarkChartAdapter,
  ChartPlotBuild,
  PlottablePoint,
  PricingControlState,
} from "./types";

/**
 * Pure chart-data plumbing: mapping records to points, query filtering, and
 * uPlot data assembly. Kept framework-free so it is unit-testable without a
 * DOM. Hover/click nearest-point resolution is delegated to uPlot's cursor
 * index, so no custom geometry lives here.
 */

/** Map records through the adapter, applying the query filter. */
export function buildChartPlot<TRecord>(
  records: readonly TRecord[],
  adapter: Readonly<BenchmarkChartAdapter<TRecord>>,
  controls: Readonly<PricingControlState>,
  query: string,
): ChartPlotBuild<TRecord> {
  const needle = query.trim().toLowerCase();
  const entries: { record: TRecord; point: PlottablePoint }[] = [];
  const unplottable: { record: TRecord; reason: string }[] = [];
  let filteredOut = 0;

  for (const record of records) {
    if (needle !== "" && !adapter.searchText(record).toLowerCase().includes(needle)) {
      filteredOut += 1;
      continue;
    }
    const point = adapter.computePoint(record, controls);
    if (point === null) {
      unplottable.push({ record, reason: "no computable cost for the current pricing mode" });
      continue;
    }
    entries.push({ record, point });
  }

  return { entries, unplottable, filteredOut };
}

/**
 * Assemble uPlot data arrays. On log scale, non-positive x values are
 * dropped (they are unrepresentable); callers get the dropped ids so the UI
 * can explain why a point disappeared after a scale switch.
 */
export function toPlotSeries(
  points: readonly PlottablePoint[],
  scale: "log" | "linear",
): { x: number[]; y: number[]; ids: string[]; droppedIds: string[] } {
  const x: number[] = [];
  const y: number[] = [];
  const ids: string[] = [];
  const droppedIds: string[] = [];
  for (const p of points) {
    if (scale === "log" && !(p.x > 0)) {
      droppedIds.push(p.id);
      continue;
    }
    ids.push(p.id);
    x.push(p.x);
    y.push(p.y);
  }
  return { x, y, ids, droppedIds };
}

/**
 * Highlight series values: aligned with the plot series, null everywhere
 * except the selected id, so uPlot draws the selection as a separate
 * emphasized series via setData (no uPlot reconstruction).
 */
export function toHighlightY(
  series: { ids: string[]; y: number[] },
  selectedId: string | null,
): (number | null)[] {
  return series.ids.map((id, i) => (id === selectedId ? (series.y[i] as number) : null));
}
