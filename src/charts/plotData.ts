import type {
  BenchmarkChartAdapter,
  ChartPlotBuild,
  PlottablePoint,
  PriceDiscountAnnotation,
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

  for (const record of records) {
    if (needle !== "" && !adapter.searchText(record).toLowerCase().includes(needle)) continue;
    const point = adapter.computePoint(record, controls);
    if (point === null) {
      unplottable.push({ record, reason: "no computable cost for the current pricing mode" });
      continue;
    }
    entries.push({ record, point });
  }

  return { entries, unplottable };
}

/** Validate one explicit source-backed discount annotation. */
export function explicitDiscountForAnnotation(
  discount: PriceDiscountAnnotation | undefined,
): PriceDiscountAnnotation | null {
  if (
    !discount || !Number.isFinite(discount.preDiscountX) || discount.preDiscountX <= 0 ||
    !Number.isFinite(discount.percentage) || discount.percentage <= 0 || discount.percentage >= 100 ||
    (discount.effectiveX !== undefined &&
      (!Number.isFinite(discount.effectiveX) || discount.effectiveX <= 0))
  ) return null;
  return discount;
}

/**
 * Assemble uPlot data arrays. On log scale, non-positive x values are
 * dropped (they are unrepresentable); callers get the dropped ids so the UI
 * can explain why a point disappeared after a scale switch.
 */
export function modelLabelWithDiscount(
  label: string,
  discount: PriceDiscountAnnotation | null,
): string {
  return discount ? `${label} (${discount.percentage}% off)` : label;
}

export function explicitDiscountCandidates(point: PlottablePoint): PriceDiscountAnnotation[] {
  const candidates = point.discounts ?? (point.discount ? [point.discount] : []);
  return candidates.flatMap((candidate) => {
    const discount = explicitDiscountForAnnotation(candidate);
    return discount ? [discount] : [];
  });
}

/** Pick one deterministic largest-percentage annotation for a model. */
export function largestExplicitDiscountForPoint(
  point: PlottablePoint,
): PriceDiscountAnnotation | null {
  const candidates = explicitDiscountCandidates(point);
  return candidates.reduce<PriceDiscountAnnotation | null>((largest, candidate) => {
    if (largest === null || candidate.percentage > largest.percentage) return candidate;
    if (candidate.percentage < largest.percentage) return largest;
    const candidateProvider = candidate.providerName ?? "";
    const largestProvider = largest.providerName ?? "";
    return candidateProvider.localeCompare(largestProvider) < 0 ? candidate : largest;
  }, null);
}

export function discountProviderRole(
  point: PlottablePoint,
  discount: PriceDiscountAnnotation,
): "plotted" | "alternative" {
  if (discount.providerRole) return discount.providerRole;
  if (discount.effectiveX === undefined) return "plotted";
  const tolerance = Math.max(0.005, Math.abs(point.x) * 1e-6);
  return Math.abs(discount.effectiveX - point.x) <= tolerance ? "plotted" : "alternative";
}

export function explicitDiscountForPoint(point: PlottablePoint): PriceDiscountAnnotation | null {
  const discount = largestExplicitDiscountForPoint(point);
  return discount && point.x > 0 ? discount : null;
}

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

export interface CrownPoint {
  id: string;
  left: number;
  top: number;
}

/**
 * Keep the top-most crown in a crowded vertical cluster. Crowns sit above
 * their dots, so a lower crown that reaches an intervening dot or an already
 * retained crown is redundant and visually misleading.
 */
export function selectCrownPoints(
  crowns: readonly CrownPoint[],
  dots: readonly CrownPoint[],
): CrownPoint[] {
  const retained: CrownPoint[] = [];
  const crownHalfWidth = 9;
  const crownTopOffset = 27;
  const crownHeight = 18;
  const dotRadius = 8;
  const intersectsCrown = (candidate: CrownPoint, other: CrownPoint) =>
    Math.abs(candidate.left - other.left) < crownHalfWidth * 2 &&
    candidate.top - crownTopOffset < other.top - crownTopOffset + crownHeight &&
    candidate.top - crownTopOffset + crownHeight > other.top - crownTopOffset;
  const intersectsDot = (candidate: CrownPoint, dot: CrownPoint) => {
    const closestLeft = Math.max(candidate.left - crownHalfWidth, Math.min(dot.left, candidate.left + crownHalfWidth));
    const closestTop = Math.max(candidate.top - crownTopOffset, Math.min(dot.top, candidate.top - crownTopOffset + crownHeight));
    return Math.hypot(dot.left - closestLeft, dot.top - closestTop) < dotRadius;
  };

  for (const candidate of [...crowns].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const hasInterveningDot = dots.some((dot) =>
      dot.id !== candidate.id && dot.top < candidate.top - crownTopOffset + crownHeight &&
      dot.top >= candidate.top - crownTopOffset && intersectsDot(candidate, dot),
    );
    if (hasInterveningDot || retained.some((crown) => intersectsCrown(candidate, crown))) continue;
    retained.push(candidate);
  }
  return retained;
}

/**
 * Return the non-dominated cost/score points in increasing-cost order.
 * Lower x and higher y are better; equal-cost points are reduced to the
 * highest score before dominance is evaluated.
 */
export function paretoFrontier(points: readonly PlottablePoint[]): PlottablePoint[] {
  const sorted = [...points]
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x || b.y - a.y || a.id.localeCompare(b.id));
  const frontier: PlottablePoint[] = [];
  let bestScore = -Infinity;

  for (let i = 0; i < sorted.length; ) {
    const point = sorted[i]!;
    let bestAtCost = point;
    let j = i + 1;
    while (j < sorted.length && sorted[j]!.x === point.x) {
      if (sorted[j]!.y > bestAtCost.y) bestAtCost = sorted[j]!;
      j += 1;
    }
    if (bestAtCost.y > bestScore) {
      frontier.push(bestAtCost);
      bestScore = bestAtCost.y;
    }
    i = j;
  }

  return frontier;
}
