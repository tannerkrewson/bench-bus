import type {
  BenchmarkChartAdapter,
  ChartPlotBuild,
  PlottablePoint,
  PriceDiscountAnnotation,
  PricingControlState,
  TooltipLine,
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

/** Validate one AA-relative savings annotation. */
export function validDiscountAnnotation(
  discount: PriceDiscountAnnotation | undefined,
): PriceDiscountAnnotation | null {
  if (
    !discount || !Number.isFinite(discount.preDiscountX) || discount.preDiscountX <= 0 ||
    !Number.isFinite(discount.percentage) || discount.percentage <= 0 || discount.percentage > 100 ||
    (discount.effectiveX !== undefined && (
      !Number.isFinite(discount.effectiveX) ||
      discount.effectiveX < 0 ||
      (discount.effectiveX === 0 && discount.percentage !== 100)
    ))
  ) return null;
  if (discount.effectiveX === undefined) return discount;
  const impliedPercentage = discountPercentageFromCosts(discount.preDiscountX, discount.effectiveX);
  if (impliedPercentage === undefined || Math.abs(impliedPercentage - discount.percentage) > 0.05) return null;
  return discount;
}

/** Structured model-label parts keep the visual discount suffix separate from
 * the canonical model name while retaining one complete accessible string. */
export interface ModelLabelParts {
  mainLabel: string;
  discountLabel?: string;
  accessibleLabel: string;
}

/** Round a source discount to the nearest whole percent for display. */
export function roundDiscountPercent(percentage: number): number {
  return Math.round(percentage);
}

/** Calculate the workload discount from the displayed pre/effective costs. */
export function discountPercentageFromCosts(
  preDiscountX: number,
  effectiveX: number,
): number | undefined {
  if (
    !Number.isFinite(preDiscountX) || preDiscountX <= 0 ||
    !Number.isFinite(effectiveX) || effectiveX < 0 || effectiveX > preDiscountX
  ) return undefined;
  return (1 - effectiveX / preDiscountX) * 100;
}

/** Name the provider responsible for the plotted savings. */
export function discountProviderSummary(discount: PriceDiscountAnnotation): string {
  return discount.providerName ?? "Cheapest OpenRouter provider";
}

/** Format the source price transformation as one compact equation. */
export function discountMath(
  point: Pick<PlottablePoint, "x">,
  discount: PriceDiscountAnnotation,
): string {
  const effectiveX = discount.effectiveX ?? point.x;
  const percentage = Number.isInteger(discount.percentage)
    ? String(discount.percentage)
    : discount.percentage.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `$${discount.preDiscountX.toFixed(2)} * (1 - ${percentage}%) = $${effectiveX.toFixed(2)}`;
}

export function discountHoverTitle(
  point: Pick<PlottablePoint, "label" | "x">,
  discount: PriceDiscountAnnotation,
): string {
  return `${point.label} (${roundDiscountPercent(discount.percentage)}% below AA listed)`;
}

/** Compact discount rows kept understandable at a glance. */
export function discountSummaryLines(
  point: Pick<PlottablePoint, "x">,
  discount: PriceDiscountAnnotation,
): TooltipLine[] {
  return [
    { label: "Savings vs AA listed", value: discountMath(point, discount) },
    { label: "Cheapest provider", value: discountProviderSummary(discount) },
  ];
}

/** Full discount rows moved out of hover and into the click-open modal. */
export function discountDetailLines(
  point: PlottablePoint,
  discount: PriceDiscountAnnotation,
): TooltipLine[] {
  return [
    { label: "Savings vs AA listed", value: `${roundDiscountPercent(discount.percentage)}% below AA listed` },
    { label: "Cheapest provider", value: discount.providerName ?? "Cheapest OpenRouter provider" },
    { label: "AA listed cost", value: `$${discount.preDiscountX.toFixed(2)}` },
    { label: "OpenRouter cost", value: `$${(discount.effectiveX ?? point.x).toFixed(2)}` },
  ];
}

export function modelLabelParts(
  label: string,
  discount: PriceDiscountAnnotation | null,
): ModelLabelParts {
  if (!discount) return { mainLabel: label, accessibleLabel: label };
  const discountLabel = `(${roundDiscountPercent(discount.percentage)}% below AA listed)`;
  return {
    mainLabel: label,
    discountLabel,
    accessibleLabel: `${label} ${discountLabel}`,
  };
}

/** Return the complete label used by tooltips and other non-visual callers. */
export function modelLabelWithDiscount(
  label: string,
  discount: PriceDiscountAnnotation | null,
): string {
  return modelLabelParts(label, discount).accessibleLabel;
}

export function discountForPoint(point: PlottablePoint): PriceDiscountAnnotation | null {
  const discount = validDiscountAnnotation(point.discount);
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
