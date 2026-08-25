import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { Crown } from "lucide-solid";
import uPlot, { type Options } from "uplot";
import { isDarkTheme } from "../components/ThemeToggle";
import "uplot/dist/uPlot.min.css";
import { inferModelBrand, modelGroupColor, modelGroupColors } from "./brand";
import { modelGroupKey } from "./modelMetadata";
import {
  groupModelVariants,
  LABEL_DISCOUNT_FONT_SIZE,
  LABEL_MAIN_FONT_SIZE,
  layoutModelLabels,
  modelVariantParts,
  type ModelVariantGroup,
  type ModelVariantMember,
} from "./labelLayout";
import {
  discountProviderRole,
  largestExplicitDiscountForPoint,
  modelLabelParts,
  paretoFrontier,
  selectCrownPoints,
  toPlotSeries,
} from "./plotData";
import { formatDollarTick, formatPercentTick } from "../utils/format";
import type { ModelBrand, PlottablePoint, XScale } from "./types";

export interface BenchmarkScatterChartProps {
  /** Points currently passing filters, in stable order. */
  points: () => readonly PlottablePoint[];
  scale: () => XScale;
  xAxisLabel: () => string;
  yAxisLabel: () => string;
  /** Model labels are enabled by default and controlled by the section toggle. */
  showLabels?: () => boolean;
  showFrontier?: () => boolean;
  showCrowns?: () => boolean;
  showDiscounts?: () => boolean;
  height?: number;
  /** Hover changes only when the pointer is within the hit radius of a dot. */
  onHover?: (id: string | null, pos?: { left: number; top: number }) => void;
  /** Open the model detail view when a plotted or discount endpoint is clicked. */
  onSelectPoint?: (id: string) => void;
}

const DOT_SIZE = 9;
const POINT_STROKE_WIDTH = 1.5;
// uPlot's point size is a diameter, while SVG circle r is a radius. Keep
// overlay emphasis circles exactly the same size as the canvas points so
// hover never creates a second, visibly larger dot.
const MODEL_DOT_RADIUS = (DOT_SIZE - POINT_STROKE_WIDTH) / 2;
const MODEL_LABEL_LINE_HEIGHT = 20;
const DOT_HIT_RADIUS = 14;
const HOVER_RING_RADIUS = MODEL_DOT_RADIUS + 3;
const DISCOUNT_HIT_RADIUS = 8;
const DISCOUNT_ENDPOINT_GAP = MODEL_DOT_RADIUS + 2;
const PLOT_ANIMATION_DURATION = 180;
const EMPHASIS_TRANSITION_DURATION = 140;
// Keep leaders visually attached to the real dot edge; the layout collision
// pass, not a large decorative gap, keeps them out of nearby dots.
const LEADER_LINE_GAP = 1;

/** Geometry for the leftward horizontal and downward vertical cursor guides. */
export interface CrosshairGuideGeometry {
  horizontal: { left: number; width: number };
  vertical: { left: number; top: number; height: number };
}

export function crosshairGuideGeometry(
  cursorLeft: number | null | undefined,
  cursorTop: number | null | undefined,
  overHeight: number,
): CrosshairGuideGeometry {
  if (cursorLeft == null || cursorTop == null) {
    return {
      horizontal: { left: 0, width: 0 },
      vertical: { left: 0, top: 0, height: 0 },
    };
  }
  const left = Math.max(0, cursorLeft);
  const top = Math.max(0, cursorTop);
  return {
    horizontal: { left: 0, width: left },
    vertical: { left, top, height: Math.max(0, overHeight - top) },
  };
}

export interface ConnectorHitSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Keep connector hit lines out of the direct-dot hit radius. */
export function trimConnectorHitSegment(
  start: { left: number; top: number },
  end: { left: number; top: number },
  inset = DOT_HIT_RADIUS,
): ConnectorHitSegment | null {
  const dx = end.left - start.left;
  const dy = end.top - start.top;
  const length = Math.hypot(dx, dy);
  if (![start.left, start.top, end.left, end.top, inset].every(Number.isFinite) || inset < 0 || length <= inset * 2) {
    return null;
  }
  const ratio = inset / length;
  return {
    x1: start.left + dx * ratio,
    y1: start.top + dy * ratio,
    x2: end.left - dx * ratio,
    y2: end.top - dy * ratio,
  };
}

/** Return the dot position only when the pointer is within the hit radius. */
export function snapToDotPosition(
  pointer: { left: number; top: number },
  dot: { left: number; top: number },
  radius = DOT_HIT_RADIUS,
): { left: number; top: number } | null {
  if (![pointer.left, pointer.top, dot.left, dot.top, radius].every(Number.isFinite) || radius < 0) return null;
  return Math.hypot(pointer.left - dot.left, pointer.top - dot.top) <= radius ? dot : null;
}

/** Return the shortest distance from a point to a finite connector segment. */
export function pointToSegmentDistance(
  point: { left: number; top: number },
  start: { left: number; top: number },
  end: { left: number; top: number },
): number {
  const dx = end.left - start.left;
  const dy = end.top - start.top;
  const lengthSquared = dx * dx + dy * dy;
  if (![point.left, point.top, start.left, start.top, end.left, end.top].every(Number.isFinite)) return Infinity;
  if (lengthSquared === 0) return Math.hypot(point.left - start.left, point.top - start.top);
  const projection = Math.max(0, Math.min(1, ((point.left - start.left) * dx + (point.top - start.top) * dy) / lengthSquared));
  return Math.hypot(point.left - (start.left + projection * dx), point.top - (start.top + projection * dy));
}

/** Trim a horizontal discount connector clear of both endpoint dot strokes. */
export function trimDiscountSegment(
  preLeft: number,
  effectiveLeft: number,
  gap = DISCOUNT_ENDPOINT_GAP,
): { x1: number; x2: number } | null {
  if (![preLeft, effectiveLeft, gap].every(Number.isFinite) || gap < 0) return null;
  const distance = Math.abs(effectiveLeft - preLeft);
  if (distance <= gap * 2) return null;
  const direction = effectiveLeft > preLeft ? 1 : -1;
  return {
    x1: preLeft + direction * gap,
    x2: effectiveLeft - direction * gap,
  };
}

/** Keep the connector's endpoint runs stable as the chart scale changes. */
export const DISCOUNT_SEGMENT_LENGTH = 28;
const DISCOUNT_ARROWHEAD_SIZE = 4;
const DISCOUNT_TICK_HALF_HEIGHT = 4;

export interface DiscountConnectorGeometry {
  segments: { x1: number; y1: number; x2: number; y2: number }[];
  arrowhead: { tipX: number; wingX: number } | null;
  tick: { x: number; halfHeight: number } | null;
}

/**
 * Build fixed-length endpoint runs and their center markers. The segment
 * array follows the input direction for compatibility; marker positions are
 * always expressed in screen-left-to-screen-right coordinates.
 */
export function discountConnectorGeometry(
  preLeft: number,
  effectiveLeft: number,
  gap = 0,
): DiscountConnectorGeometry {
  const trimmed = trimDiscountSegment(preLeft, effectiveLeft, gap);
  if (!trimmed) return { segments: [], arrowhead: null, tick: null };
  const { x1, x2 } = trimmed;
  const span = Math.abs(x2 - x1);
  const direction = x2 > x1 ? 1 : -1;
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  if (span <= DISCOUNT_SEGMENT_LENGTH * 2) {
    return {
      segments: [{ x1, y1: 0, x2, y2: 0 }],
      arrowhead: null,
      tick: null,
    };
  }
  const leftSegment = { x1: left, y1: 0, x2: left + DISCOUNT_SEGMENT_LENGTH, y2: 0 };
  const rightSegment = { x1: right - DISCOUNT_SEGMENT_LENGTH, y1: 0, x2: right, y2: 0 };
  const reverse = (segment: typeof leftSegment) => ({
    x1: segment.x2,
    y1: segment.y2,
    x2: segment.x1,
    y2: segment.y1,
  });
  return {
    segments: direction === 1
      ? [leftSegment, rightSegment]
      : [reverse(rightSegment), reverse(leftSegment)],
    arrowhead: {
      tipX: leftSegment.x2,
      wingX: leftSegment.x2 + DISCOUNT_ARROWHEAD_SIZE,
    },
    tick: {
      x: rightSegment.x1,
      halfHeight: DISCOUNT_TICK_HALF_HEIGHT,
    },
  };
}

export function discountLineSegments(
  preLeft: number,
  effectiveLeft: number,
  gap = 0,
): DiscountConnectorGeometry["segments"] {
  return discountConnectorGeometry(preLeft, effectiveLeft, gap).segments;
}

/** Build the literal left-pointing angle bracket used at the left run's end. */
export function discountArrowheadPath(tipX: number, top: number, wingX: number): string {
  return `M ${wingX} ${top - (wingX - tipX)} L ${tipX} ${top} L ${wingX} ${top + (wingX - tipX)}`;
}

/** uPlot split filters kept pure so axis and grid policies stay regression-testable. */
export function filterDollarAxisSplits(splits: readonly number[]): (number | null)[] {
  return splits.map((value) => formatDollarTick(value) !== "" ? value : null);
}

/** Generate clean major dollar ticks for a log axis instead of uPlot's
 * additive minor split sequence (which starts at the padded minimum). */
export function logDollarAxisSplits(scaleMin: number, scaleMax: number): number[] {
  if (!Number.isFinite(scaleMin) || !Number.isFinite(scaleMax) || scaleMin <= 0 || scaleMax <= 0 || scaleMax < scaleMin) {
    return [];
  }
  const powers: number[] = [];
  for (let exponent = Math.ceil(Math.log10(scaleMin)); exponent <= Math.floor(Math.log10(scaleMax)); exponent += 1) {
    powers.push(10 ** exponent);
  }
  return powers.length > 0 ? powers : [...new Set([scaleMin, scaleMax])];
}

/** Keep log-dollar powers of ten and the valid endpoints of an active range. */
export function filterLogDollarAxisSplits(splits: readonly number[]): (number | null)[] {
  const valid = splits.filter((value) => Number.isFinite(value) && value > 0);
  const first = valid[0];
  const last = valid[valid.length - 1];
  return splits.map((value) => {
    if (!Number.isFinite(value) || value <= 0) return null;
    const exponent = Math.log10(value);
    const isPowerOfTen = Math.abs(exponent - Math.round(exponent)) < 1e-10;
    return isPowerOfTen || value === first || value === last ? value : null;
  });
}

export function filterIntegerAxisSplits(splits: readonly number[]): (number | null)[] {
  return splits.map((value) => Number.isInteger(value) ? value : null);
}

/** Intelligence scores use only clean 5-point labels (…0 and …5). */
export function filterIntelligenceAxisSplits(splits: readonly number[]): (number | null)[] {
  return splits.map((value) => Number.isInteger(value) && value % 5 === 0 ? value : null);
}

export function filterTenPointGridSplits(splits: readonly number[]): (number | null)[] {
  return splits.map((value) => Number.isInteger(value) && value % 10 === 0 ? value : null);
}

/** Convert filtered uPlot splits to labels without rendering filtered nulls. */
export function formatFilteredAxisValues(
  splits: readonly (number | null)[],
  formatter: (value: number) => string,
): string[] {
  return splits.map((value) => value === null ? "" : formatter(value));
}

/**
 * Keep the focused family at its normal series alpha while de-emphasizing
 * every unrelated uPlot series. Point rows are grouped by model-family key;
 * connector rows are grouped by variant-group order.
 */
export function seriesAlphasForFocus(
  baseAlphas: readonly number[],
  focused: boolean,
  connectorCount: number,
  discountCount: number,
  pointGroupKeys: readonly string[],
  focusedConnectorIndex: number | null,
  focusedPointGroupKeys: ReadonlySet<string> | null,
): number[] {
  if (!focused) return [...baseAlphas];
  const pointOffset = 1 + connectorCount + discountCount;
  return baseAlphas.map((baseAlpha, index) => {
    const connectorFocused = focusedConnectorIndex !== null && index === 1 + focusedConnectorIndex;
    const pointGroupIndex = index - pointOffset;
    const pointFocused = pointGroupIndex >= 0 && pointGroupIndex < pointGroupKeys.length &&
      focusedPointGroupKeys?.has(pointGroupKeys[pointGroupIndex]!) === true;
    return connectorFocused || pointFocused ? baseAlpha : Math.min(baseAlpha, 0.2);
  });
}

type DiscountAnnotation = {
  id: string;
  pointId: string;
  preX: number;
  effectiveX: number;
  y: number;
  percentage: number;
  groupKey: string;
  providerName?: string;
  providerRole?: "plotted" | "alternative";
};

type DiscountDecoration = {
  id: string;
  pointId: string;
  preX: number;
  effectiveX: number;
  y: number;
  preLeft: number;
  effectiveLeft: number;
  top: number;
  percentage: number;
  groupKey: string;
  color: string;
  providerRole?: "plotted" | "alternative";
};

type CurrentSeries = ReturnType<typeof toPlotSeries> & {
  labels: string[];
  labelParts: ReturnType<typeof modelLabelParts>[];
  effortGroups: (string | null)[];
  groupKeys: string[];
  brands: ModelBrand[];
  frontierIds: string[];
  variantGroups: ModelVariantGroup[];
  discounts: DiscountAnnotation[];
};

/**
 * Reusable uPlot scatter wrapper. uPlot remains responsible for axes and
 * interaction, while brand series, the frontier, and labels are derived from
 * the same point set so all three stay aligned after filtering or pricing
 * changes.
 */
export default function BenchmarkScatterChart(props: BenchmarkScatterChartProps) {
  let container: HTMLDivElement | undefined;
  let plot: uPlot | null = null;
  let plotStructureKey = "";
  let hoveredIndex: number | null = null;
  let plotUpdateFrame: number | null = null;
  let plotAnimationFrame: number | null = null;
  let emphasisAnimationFrame: number | null = null;
  let labelUpdateFrame: number | null = null;
  type PlotDataShape = {
    pathIds: string[];
    pathSlots: string[];
    pointIds: string[];
    connectorGroupKeys: string[];
    pointGroupKeys: string[];
  };
  type PlotDataSnapshot = { shape: PlotDataShape };
  let previousPlotData: PlotDataSnapshot | null = null;
  let currentSeries: CurrentSeries = {
    x: [],
    y: [],
    ids: [],
    droppedIds: [],
    labels: [],
    labelParts: [],
    effortGroups: [],
    groupKeys: [],
    brands: [],
    frontierIds: [],
    variantGroups: [],
    discounts: [],
  };
  const [labelPositions, setLabelPositions] = createSignal<ReturnType<typeof layoutModelLabels>>([]);
  const [hoveredPosition, setHoveredPosition] = createSignal<{ left: number; top: number } | null>(null);
  const [hoveredAxisReadout, setHoveredAxisReadout] = createSignal<{
    left: number;
    top: number;
    cost: number;
    score: number;
    color: string;
    axisLeft: number;
    axisBottom: number;
  } | null>(null);
  const [hoveredCrownId, setHoveredCrownId] = createSignal<string | null>(null);
  const [hoveredLabelId, setHoveredLabelId] = createSignal<string | null>(null);
  const clearHoveredPoint = () => {
    setHoveredPosition(null);
    setHoveredAxisReadout(null);
  };
  const publishHoveredPosition = (position: { left: number; top: number } | null) => {
    setHoveredPosition(position);
    const readout = hoveredAxisReadout();
    if (readout && position) setHoveredAxisReadout({ ...readout, left: position.left, top: position.top });
  };
  const [pointDecorations, setPointDecorations] = createSignal<{
    id: string;
    left: number;
    top: number;
    color: string;
    modelLabel: string;
  }[]>([]);
  const [discountDecorations, setDiscountDecorations] = createSignal<DiscountDecoration[]>([]);
  const [plotXSnapshot, setPlotXSnapshot] = createSignal("");
  // currentSeries and plot are intentionally kept outside Solid because uPlot
  // owns their lifecycle. Publish a revision after each completed plot render
  // or resize so SVG memos never retain geometry from the previous uPlot
  // instance/data.
  const [plotRevision, setPlotRevision] = createSignal(0);
  let hoveredLabelBounds: { left: number; top: number; right: number; bottom: number } | null = null;
  // Connector hit lines sit above the uPlot surface, so retain their owner
  // independently from the cursor state. Labels use the same family focus,
  // but never own a dot tooltip or snapped cursor.
  let hoveredConnectorId: string | null = null;
  let hoveredDiscountEndpointId: string | null = null;
  let baseSeriesAlphas: number[] = [];

  const refreshSeries = () => {
    const points = props.points();
    const series = toPlotSeries(points, props.scale());
    const pointById = new Map(points.map((point) => [point.id, point]));
    const plottedPoints = series.ids
      .map((id) => pointById.get(id))
      .filter((point): point is PlottablePoint => point !== undefined);
    const frontierIds = paretoFrontier(plottedPoints).map((point) => point.id);
    const groupKeyById = new Map(series.ids.map((id) => {
      const point = pointById.get(id);
      return [id, point?.effortGroup ?? modelGroupKey(point?.label ?? id, id)] as const;
    }));
    const members: ModelVariantMember[] = series.ids.flatMap((id) => {
      const point = pointById.get(id);
      if (!point) return [];
      return [{
        id,
        label: point.label,
        brand: point.brand ?? inferModelBrand(point.label, id),
        effortGroup: point.effortGroup,
        effort: point.effort,
        x: point.x,
        y: point.y,
      }];
    });
    const variantGroups = groupModelVariants(members);
    const groupedIds = new Set(variantGroups.flatMap((group) => group.members.map((member) => member.id)));
    const orderedIds = [
      ...variantGroups.flatMap((group) => group.members.map((member) => member.id)),
      ...series.ids.filter((id) => !groupedIds.has(id)),
    ];
    const indexById = new Map(series.ids.map((id, index) => [id, index]));

    const orderedPoints = orderedIds.map((id) => pointById.get(id)).filter(
      (point): point is PlottablePoint => point !== undefined,
    );
    const discounts: DiscountAnnotation[] = (props.showDiscounts?.() ?? true)
      ? orderedPoints.flatMap((point) => {
          const discount = largestExplicitDiscountForPoint(point);
          // A valid 100% discount may have a source effective cost of zero.
          // Keep it in labels/tooltips, but do not pass that endpoint to uPlot
          // or a log-scale SVG decoration.
          if (!discount || (props.scale() === "log" && discount.effectiveX !== undefined && discount.effectiveX <= 0)) return [];
          return [{
            id: point.id,
            pointId: point.id,
            preX: discount.preDiscountX,
            effectiveX: discount.effectiveX ?? point.x,
            y: point.y,
            percentage: discount.percentage,
            groupKey: groupKeyById.get(point.id) ?? modelGroupKey(point.label, point.id),
            providerName: discount.providerName,
            providerRole: discountProviderRole(point, discount),
          }];
        })
      : [];
    const labelParts = orderedIds.map((id) => {
      const point = pointById.get(id);
      if (!point) return modelLabelParts(id, null);
      const discount = props.showDiscounts?.() ?? true ? largestExplicitDiscountForPoint(point) : null;
      return modelLabelParts(point.label, discount);
    });
    currentSeries = {
      x: orderedIds.map((id) => series.x[indexById.get(id)!]!),
      y: orderedIds.map((id) => series.y[indexById.get(id)!]!),
      ids: orderedIds,
      droppedIds: series.droppedIds,
      labels: labelParts.map((parts) => parts.accessibleLabel),
      labelParts,
      // Keep the source family key even when only one effort variant is
      // visible; its representative label should still use the family base.
      effortGroups: orderedIds.map((id) => pointById.get(id)?.effortGroup ?? null),
      groupKeys: orderedIds.map((id) => groupKeyById.get(id) ?? modelGroupKey(id, id)),
      brands: orderedIds.map((id) => {
        const point = pointById.get(id);
        return point?.brand ?? inferModelBrand(point?.label, id);
      }),
      frontierIds,
      variantGroups,
      discounts,
    };
    return currentSeries;
  };

  const groupColor = (groupKey: string, dark: boolean): string => {
    const visibleGroups = [
      ...currentSeries.groupKeys,
      ...currentSeries.variantGroups.map((group) => group.key),
      ...currentSeries.discounts.map((discount) => discount.groupKey),
    ];
    return modelGroupColors(visibleGroups, dark).get(groupKey) ?? modelGroupColor(groupKey, dark);
  };

  const themeStyles = () => {
    const styles = getComputedStyle(container ?? document.documentElement);
    const dark = isDarkTheme(document.documentElement.dataset.theme);
    return {
      dark,
      textColor:
        styles.getPropertyValue("--color-base-content").trim() || styles.color || "#111827",
      gridColor:
        styles.getPropertyValue("--color-base-300").trim() || "rgba(128,128,128,.25)",
      frontierColor:
        styles.getPropertyValue("--color-primary").trim() || (dark ? "#a78bfa" : "#4f46e5"),
      leaderColor: dark ? "#94a3b8" : "#64748b",
    };
  };

  const plotDataShape = (): PlotDataShape => {
    const pathIds = [
      ...currentSeries.frontierIds,
      ...currentSeries.variantGroups.flatMap((group) => group.members.map((member) => member.id)),
    ];
    const pathOccurrences = new Map<string, number>();
    const pathSlots = pathIds.map((id) => {
      const occurrence = pathOccurrences.get(id) ?? 0;
      pathOccurrences.set(id, occurrence + 1);
      return `${id}#${occurrence}`;
    });
    return {
      pathIds,
      pathSlots,
      pointIds: [...currentSeries.ids],
      connectorGroupKeys: currentSeries.variantGroups.map((group) => group.key),
      pointGroupKeys: [...new Set(currentSeries.groupKeys)],
    };
  };

  const dataFor = (): uPlot.AlignedData => {
    const pointById = new Map(
      currentSeries.ids.map((id, index) => [id, { x: currentSeries.x[index]!, y: currentSeries.y[index]! }]),
    );
    const { pathIds, pointGroupKeys } = plotDataShape();
    // Discount endpoints are rendered only by the SVG overlay. Do not append
    // their x values to uPlot's aligned data: alternative-provider endpoints
    // can be out of order with plotted points, and uPlot requires sorted x data
    // on log scales. The scale range below includes their bounds separately.
    const pathX = pathIds.map((id) => pointById.get(id)?.x ?? 0);
    const pathLength = pathX.length;
    const actualOffset = pathLength;
    const actualLength = currentSeries.ids.length;
    const dataX = [
      ...pathX,
      ...currentSeries.x,
    ];
    const frontierY = [
      ...(props.showFrontier?.() ?? false)
        ? currentSeries.frontierIds.map((id) => pointById.get(id)?.y ?? null)
        : new Array<number | null>(currentSeries.frontierIds.length).fill(null),
      ...new Array<number | null>(pathLength - currentSeries.frontierIds.length + actualLength).fill(null),
    ];
    let groupOffset = 0;
    const connectorRows = currentSeries.variantGroups.map((group) => {
      const row = new Array<number | null>(dataX.length).fill(null);
      group.members.forEach((member, index) => {
        row[currentSeries.frontierIds.length + groupOffset + index] = member.y;
      });
      groupOffset += group.members.length;
      return row;
    });
    // Keep one uPlot series per model family. The same family key drives its
    // point, effort connector, discount arrow, and selector color.
    const pointRows = pointGroupKeys.map((groupKey) => {
      const row = new Array<number | null>(dataX.length).fill(null);
      currentSeries.groupKeys.forEach((pointGroupKey, index) => {
        if (pointGroupKey === groupKey) row[actualOffset + index] = currentSeries.y[index]!;
      });
      return row;
    });
    // uPlot accepts null-gapped plain arrays at runtime; its typings only
    // cover TypedArrays, so the sparse rows are cast at this boundary.
    // Pareto is deliberately the final data row so uPlot paints it above all
    // model-family connectors and discount segments.
    return [Float64Array.from(dataX), ...connectorRows, ...pointRows, frontierY] as unknown as uPlot.AlignedData;
  };

  type HoverTarget = {
    pointIndex: number;
    id: string;
    plotLeft: number;
    plotTop: number;
    dataIndex: number;
    cost?: number;
  };

  const pointerPlotPosition = (u: uPlot): { left: number; top: number } | undefined => {
    const event = (u.cursor as uPlot.Cursor & { event?: MouseEvent }).event;
    const over = container?.querySelector<HTMLElement>(".u-over");
    if (event && over && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      const overRect = over.getBoundingClientRect();
      return { left: event.clientX - overRect.left, top: event.clientY - overRect.top };
    }
    if (u.cursor.left != null && u.cursor.top != null) {
      return { left: u.cursor.left, top: u.cursor.top };
    }
    return undefined;
  };

  const hoveredTarget = (u: uPlot, pointer = pointerPlotPosition(u)): HoverTarget | null => {
    if (!pointer) return null;
    const connectorLength = currentSeries.frontierIds.length + currentSeries.variantGroups.reduce(
      (total, group) => total + group.members.length,
      0,
    );
    const actualOffset = connectorLength;
    const targets: (HoverTarget & { distance: number })[] = [];
    currentSeries.ids.forEach((id, index) => {
      const x = currentSeries.x[index];
      const y = currentSeries.y[index];
      if (x === undefined || y === undefined) return;
      const plotLeft = u.valToPos(x, "x");
      const plotTop = u.valToPos(y, "y");
      if (plotLeft === undefined || plotTop === undefined) return;
      targets.push({
        pointIndex: index,
        id,
        plotLeft,
        plotTop,
        dataIndex: actualOffset + index,
        distance: Math.hypot(plotLeft - pointer.left, plotTop - pointer.top),
      });
    });
    // A discount source endpoint is a real model interaction target too. It is
    // kept outside uPlot's point series so it cannot create a duplicate dot,
    // but it should still open the same model tooltip as the plotted endpoint.
    currentSeries.discounts.forEach((discount) => {
      const pointIndex = currentSeries.ids.indexOf(discount.pointId);
      if (pointIndex < 0) return;
      const plotLeft = u.valToPos(discount.preX, "x");
      const plotTop = u.valToPos(discount.y, "y");
      if (!Number.isFinite(plotLeft) || !Number.isFinite(plotTop)) return;
      targets.push({
        pointIndex,
        id: discount.pointId,
        plotLeft,
        plotTop,
        dataIndex: actualOffset + pointIndex,
        cost: discount.preX,
        distance: Math.hypot(plotLeft - pointer.left, plotTop - pointer.top),
      });
    });
    const nearest = targets.reduce<((typeof targets)[number]) | null>(
      (best, target) => target.distance < (best?.distance ?? Infinity) ? target : best,
      null,
    );
    return nearest && snapToDotPosition(
      pointer,
      { left: nearest.plotLeft, top: nearest.plotTop },
      DOT_HIT_RADIUS,
    ) ? nearest : null;
  };

  const updateLabelPositions = () => {
    if (!plot || !container?.parentElement) {
      setLabelPositions([]);
      setPointDecorations([]);
      setDiscountDecorations([]);
      hoveredLabelBounds = null;
      setHoveredLabelId(null);
      return;
    }
    const currentPlot = plot;
    const over = container.querySelector<HTMLElement>(".u-over");
    if (!over) {
      setLabelPositions([]);
      setDiscountDecorations([]);
      hoveredLabelBounds = null;
      setHoveredLabelId(null);
      return;
    }

    const rootRect = container.parentElement.getBoundingClientRect();
    const overRect = over.getBoundingClientRect();
    const bounds = {
      left: overRect.left - rootRect.left + 4,
      top: overRect.top - rootRect.top + 4,
      right: overRect.right - rootRect.left - 4,
      bottom: overRect.bottom - rootRect.top - 4,
    };
    const styles = themeStyles();
    const dark = styles.dark;
    const representativeById = new Map(
      currentSeries.variantGroups.flatMap((group) =>
        group.members.map((member) => [member.id, group.representativeId] as const),
      ),
    );
    const allCrownDecorations = currentSeries.ids.flatMap((id, index) => {
      const position = pointPosition(currentPlot, index);
      if (!position || !currentSeries.frontierIds.includes(id)) return [];
      return [{
        id,
        left: position.left,
        top: position.top,
        color: themeStyles().textColor,
        modelLabel: currentSeries.labels[index] ?? id,
      }];
    });
    const crownDots = currentSeries.ids.flatMap((id, index) => {
      const position = pointPosition(currentPlot, index);
      if (!position) return [];
      return [{
        id,
        left: position.left,
        top: position.top,
      }];
    });
    const retainedCrownIds = new Set(selectCrownPoints(allCrownDecorations, crownDots).map((crown) => crown.id));
    const retainedCrowns = allCrownDecorations.filter((crown) => retainedCrownIds.has(crown.id));
    setPointDecorations((props.showCrowns?.() ?? true) ? retainedCrowns : []);
    const crownObstacles = retainedCrowns.map((crown) => ({
      id: `crown:${crown.id}`,
      left: crown.left,
      top: crown.top - 18,
      radius: 11,
    }));
    const discountGeometry = currentSeries.discounts.flatMap((discount) => {
      const pointIndex = currentSeries.ids.indexOf(discount.pointId);
      const plottedPosition = pointIndex >= 0 ? pointPosition(currentPlot, pointIndex) : undefined;
      if (!plottedPosition) return [];
      const preLeft = overRect.left - rootRect.left + currentPlot.valToPos(discount.preX, "x");
      // The plotted model dot is the single effective endpoint for the chart.
      // Alternative provider metadata may have a different effectiveX, but
      // drawing that second provider endpoint creates a false visual gap from
      // the model's actual plotted price.
      const effectiveLeft = plottedPosition.left;
      const top = plottedPosition.top;
      if (![preLeft, effectiveLeft, top].every(Number.isFinite)) return [];
      return [{
        id: discount.id,
        pointId: discount.pointId,
        preX: discount.preX,
        effectiveX: discount.effectiveX,
        y: discount.y,
        preLeft,
        effectiveLeft,
        top,
        percentage: discount.percentage,
        groupKey: discount.groupKey,
        color: groupColor(discount.groupKey, dark),
        providerRole: discount.providerRole,
      }];
    });
    setDiscountDecorations(discountGeometry);
    const discountLines = discountGeometry.map((discount) => ({
      left1: discount.preLeft,
      top1: discount.top,
      left2: discount.effectiveLeft,
      top2: discount.top,
    }));
    const anchors = currentSeries.ids.flatMap((id, index) => {
      const representativeId = representativeById.get(id);
      if (representativeId !== undefined && representativeId !== id) return [];
      const pointLabel = currentSeries.labelParts[index] ?? modelLabelParts(currentSeries.labels[index] ?? id, null);
      const position = pointPosition(currentPlot, index);
      if (!position) return [];
      const representativeGroup = representativeId === undefined
        ? undefined
        : currentSeries.variantGroups.find((group) => group.representativeId === representativeId);
      // A connected effort group gets one concise family label. Keep the
      // representative point's canonical effort-bearing name in aria-label
      // and the tooltip-facing series data, while the visual label uses the
      // family base name to avoid implying that only one effort is shown.
      const singletonEffortBase = representativeGroup === undefined && pointLabel.mainLabel &&
        currentSeries.effortGroups[index] !== null && currentSeries.effortGroups[index] !== undefined
        ? modelVariantParts(pointLabel.mainLabel)?.baseLabel
        : undefined;
      const mainLabel = representativeGroup?.baseLabel ?? singletonEffortBase ?? pointLabel.mainLabel;
      const visibleLabel = pointLabel.discountLabel
        ? `${mainLabel} ${pointLabel.discountLabel}`
        : mainLabel;
      return [
        {
          id,
          label: visibleLabel,
          mainLabel,
          discountLabel: pointLabel.discountLabel,
          accessibleLabel: pointLabel.accessibleLabel,
          anchorLeft: position.left,
          anchorTop: position.top,
          color: groupColor(currentSeries.groupKeys[index] ?? modelGroupKey(currentSeries.labels[index] ?? id, id), dark),
          priority: currentSeries.frontierIds.includes(id) ? 1 : 0,
        },
      ];
    });
    const obstacles = currentSeries.ids.flatMap((id, index) => {
      const position = pointPosition(currentPlot, index);
      if (!position) return [];
      return [{
        id,
        left: position.left,
        top: position.top,
      }];
    });
    const baseLabels = layoutModelLabels(anchors, bounds, {
      obstacles: [...obstacles, ...crownObstacles],
      lines: discountLines,
      leaderObstacles: [...obstacles, ...crownObstacles],
    });
    const labels = baseLabels;
    setLabelPositions(props.showLabels?.() ?? true ? labels : []);
    // Re-read the dot position after uPlot has laid out the plot. This keeps
    // the hover emphasis centered when a scale or container size changes.
    if (hoveredIndex !== null) {
      publishHoveredPosition(pointPosition(currentPlot, hoveredIndex) ?? null);
    }
  };

  const scheduleLabelPositions = () => {
    if (labelUpdateFrame !== null) return;
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      labelUpdateFrame = window.requestAnimationFrame(() => {
        labelUpdateFrame = null;
        updateLabelPositions();
        // uPlot's first layout can complete after its constructor returns.
        // Publish another imperative-lifecycle revision after the overlay has
        // real DOM geometry so connector hit targets do not retain Infinity
        // coordinates from the pre-layout plot.
        setPlotRevision((revision) => revision + 1);
      });
    } else {
      updateLabelPositions();
      setPlotRevision((revision) => revision + 1);
    }
  };

  const setLabelHover = (id: string | null) => {
    setHoveredLabelId(id);
    hoveredLabelBounds = null;
  };

  const setModelLabelHover = (id: string | null) => {
    setLabelHover(id);
    // A dot tooltip may already be open when the pointer enters the label.
    // Labels intentionally own only emphasis, never tooltip content.
    props.onHover?.(null);
  };

  const setConnectorHover = (id: string) => {
    hoveredConnectorId = id;
    hoveredIndex = null;
    clearHoveredPoint();
    setModelLabelHover(id);
  };

  const clearConnectorHover = (id: string) => {
    if (hoveredConnectorId !== id) return;
    hoveredConnectorId = null;
    setLabelHover(null);
    props.onHover?.(null);
  };

  const setDiscountEndpointHover = (discount: DiscountDecoration) => {
    if (!plot) return;
    const pointIndex = currentSeries.ids.indexOf(discount.pointId);
    if (pointIndex < 0) return;
    const plotLeft = plot.valToPos(discount.preX, "x");
    const plotTop = plot.valToPos(discount.y, "y");
    if (!Number.isFinite(plotLeft) || !Number.isFinite(plotTop)) return;
    hoveredDiscountEndpointId = `${discount.id}:pre`;
    hoveredConnectorId = null;
    hoveredIndex = pointIndex;
    hoveredLabelBounds = null;
    setHoveredLabelId(null);
    const target: HoverTarget = {
      pointIndex,
      id: discount.pointId,
      plotLeft,
      plotTop,
      dataIndex: pointIndex,
      cost: discount.preX,
    };
    const dot = { left: discount.preLeft, top: discount.top };
    plot.setCursor({ left: plotLeft, top: plotTop }, false);
    applyCrosshairDirections(plot, { left: plotLeft, top: plotTop });
    publishHoveredPosition(dot ?? null);
    publishHoveredReadout(target, dot);
    props.onHover?.(discount.pointId, dot);
  };

  const clearDiscountEndpointHover = (id: string) => {
    if (hoveredDiscountEndpointId !== id) return;
    hoveredDiscountEndpointId = null;
    hoveredIndex = null;
    clearHoveredPoint();
    props.onHover?.(null);
    if (plot) applyCrosshairDirections(plot, { left: null, top: null });
  };

  const clearPointerInteraction = () => {
    hoveredIndex = null;
    hoveredConnectorId = null;
    hoveredDiscountEndpointId = null;
    hoveredLabelBounds = null;
    setHoveredLabelId(null);
    clearHoveredPoint();
    props.onHover?.(null);
    if (plot) applyCrosshairDirections(plot, { left: null, top: null });
  };

  const cursorPosition = (u: uPlot) => {
    const over = container?.querySelector<HTMLElement>(".u-over");
    const parent = container?.parentElement;
    if (!over || !parent) return undefined;
    const parentRect = parent.getBoundingClientRect();
    const overRect = over.getBoundingClientRect();
    return {
      left: overRect.left - parentRect.left + (u.cursor.left ?? 0),
      top: overRect.top - parentRect.top + (u.cursor.top ?? 0),
    };
  };

  // uPlot updates cursor.left/top to the snapped dot position. Its last DOM
  // event still carries the pointer's actual position, which is needed to
  // undo that snap as soon as the pointer leaves the hit radius.
  /** Mouse coordinates in uPlot's .u-over coordinate space. */
  const pointerEventPosition = (u: uPlot) => {
    const event = (u.cursor as uPlot.Cursor & { event?: MouseEvent }).event;
    const over = container?.querySelector<HTMLElement>(".u-over");
    if (!event || !over || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      return undefined;
    }
    const overRect = over.getBoundingClientRect();
    return {
      left: event.clientX - overRect.left,
      top: event.clientY - overRect.top,
    };
  };

  const plotPosition = (plotLeft: number, plotTop: number) => {
    const over = container?.querySelector<HTMLElement>(".u-over");
    const parent = container?.parentElement;
    if (!over || !parent) return undefined;
    const parentRect = parent.getBoundingClientRect();
    const overRect = over.getBoundingClientRect();
    return {
      left: overRect.left - parentRect.left + plotLeft,
      top: overRect.top - parentRect.top + plotTop,
    };
  };

  const pointPosition = (u: uPlot, index: number) => {
    // Read the model's values from uPlot's current data, not currentSeries.
    // During a transition currentSeries already contains the destination while
    // u.data contains the interpolated frame; using the former made labels,
    // crowns, and connector overlays jump before the canvas dots moved.
    const pathLength = currentSeries.frontierIds.length + currentSeries.variantGroups.reduce(
      (total, group) => total + group.members.length,
      0,
    );
    const pointGroups = [...new Set(currentSeries.groupKeys)];
    const groupIndex = pointGroups.indexOf(currentSeries.groupKeys[index]!);
    if (groupIndex < 0) return undefined;
    const dataIndex = pathLength + index;
    const x = u.data[0]?.[dataIndex];
    const y = u.data[1 + currentSeries.variantGroups.length + groupIndex]?.[dataIndex];
    if (typeof x !== "number" || typeof y !== "number") return undefined;
    const plotLeft = u.valToPos(x, "x");
    const plotTop = u.valToPos(y, "y");
    if (!Number.isFinite(plotLeft) || !Number.isFinite(plotTop)) return undefined;
    return plotPosition(plotLeft, plotTop);
  };

  const publishHoveredReadout = (target: HoverTarget, dot: { left: number; top: number } | undefined) => {
    const cost = target.cost ?? currentSeries.x[target.pointIndex];
    const score = currentSeries.y[target.pointIndex];
    const over = container?.querySelector<HTMLElement>(".u-over");
    const parent = container?.parentElement;
    if (!dot || cost === undefined || score === undefined || !over || !parent) {
      setHoveredAxisReadout(null);
      return;
    }
    const overRect = over.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    setHoveredAxisReadout({
      left: dot.left,
      top: dot.top,
      cost,
      score,
      color: groupColor(
        currentSeries.groupKeys[target.pointIndex] ?? modelGroupKey(target.id, target.id),
        themeStyles().dark,
      ),
      axisLeft: overRect.left - parentRect.left,
      axisBottom: overRect.bottom - parentRect.top,
    });
  };

  const updateLabelHover = (pointer: { left: number; top: number } | undefined) => {
    // Pointer movement over a connector belongs to its family hit target;
    // do not let the root overlay's passive bookkeeping clear that focus.
    if (hoveredConnectorId !== null) return;
    const currentId = hoveredLabelId();
    // Keep label hit bounds close to the painted text. A large invisible
    // padding overlaps neighboring dots and creates the reported two-stage
    // tooltip/de-emphasis transition.
    const padding = 2;
    const contains = (rect: { left: number; top: number; right: number; bottom: number }) =>
      pointer !== undefined && pointer.left >= rect.left - padding && pointer.left <= rect.right + padding &&
      pointer.top >= rect.top - padding && pointer.top <= rect.bottom + padding;
    let nextId: string | null = null;
    if (pointer !== undefined && (props.showLabels?.() ?? true)) {
      const current = currentId === null
        ? undefined
        : labelPositions().find((label) => label.id === currentId);
      if ((hoveredLabelBounds !== null && contains(hoveredLabelBounds)) ||
          (current !== undefined && contains({
            left: current.left,
            top: current.top,
            right: current.left + current.width,
            bottom: current.top + current.height,
          }))) {
        nextId = currentId;
      } else {
        nextId = labelPositions().find((label) => contains({
          left: label.left,
          top: label.top,
          right: label.left + label.width,
          bottom: label.top + label.height,
        }))?.id ?? null;
      }
    }
    if (nextId === currentId) return;
    const next = nextId === null ? undefined : labelPositions().find((label) => label.id === nextId);
    hoveredLabelBounds = next
      ? { left: next.left, top: next.top, right: next.left + next.width, bottom: next.top + next.height }
      : null;
    setHoveredLabelId(nextId);
  };

  const applyCrosshairDirections = (
    u: uPlot,
    position: { left?: number | null; top?: number | null } = u.cursor,
  ) => {
    const over = container?.querySelector<HTMLElement>(".u-over");
    const horizontal = container?.querySelector<HTMLElement>(".u-cursor-y");
    const vertical = container?.querySelector<HTMLElement>(".u-cursor-x");
    if (!over || !horizontal || !vertical) return;
    const geometry = crosshairGuideGeometry(position.left, position.top, over.clientHeight);
    horizontal.style.left = `${geometry.horizontal.left}px`;
    horizontal.style.width = `${geometry.horizontal.width}px`;
    vertical.style.left = "0px";
    vertical.style.top = `${geometry.vertical.top}px`;
    vertical.style.height = `${geometry.vertical.height}px`;
    // uPlot positions these elements with transform(). Setting left as well
    // would apply the x coordinate twice (the reported ~2x offset). Keep the
    // library's transform contract and update it explicitly for overlay events
    // that do not pass through uPlot's .u-over handler.
    vertical.style.transform = `translate(${geometry.vertical.left}px,0px)`;
    horizontal.style.transform = `translate(0px,${geometry.horizontal.width === 0 ? 0 : geometry.vertical.top}px)`;
  };

  const buildOptions = (): Options => {
    const scale = props.scale();
    const styles = themeStyles();
    const pointGroups = [...new Set(currentSeries.groupKeys)];
    plotStructureKey = `${currentSeries.discounts.length}|${currentSeries.variantGroups
      .map((group) => `${group.key}:${group.members.length}`)
      .join("|")}|${pointGroups.join("|")}`;
    return {
      width: container?.clientWidth ?? 0,
      height: props.height ?? (typeof window !== "undefined" && window.innerWidth < 640 ? 520 : 700),
      // time:false is essential — uPlot defaults the x axis to epoch-time
      // formatting, which collapses USD costs into one pixel cluster. Keep
      // sub-$1k models in view instead of snapping the log range to $1k.
      scales: {
        x: {
          time: false,
          distr: scale === "log" ? 3 : 1,
          log: 10,
          range:
            scale === "log"
              ? (u, min, max) => {
                  const values = [
                    ...(u.data?.[0]
                      ? Array.from(u.data[0] as ArrayLike<number>)
                      : []),
                    ...currentSeries.discounts.map((discount) => discount.preX),
                  ].filter((value) => Number.isFinite(value) && value > 0);
                  if (values.length === 0) return [min, max];
                  return [Math.min(...values) / 1.2, Math.max(...values) * 1.2];
                }
              : (u, min, max) => {
                  const values = [
                    ...(u.data?.[0]
                      ? Array.from(u.data[0] as ArrayLike<number>)
                      : []),
                    ...currentSeries.discounts.map((discount) => discount.preX),
                  ].filter((value) => Number.isFinite(value));
                  if (values.length === 0) return [min, max];
                  const low = Math.min(...values);
                  const high = Math.max(...values);
                  const pad = (high - low || Math.max(Math.abs(low), 1)) * 0.08;
                  return [low - pad, high + pad];
                },
        },
      },
      axes: [
        {
          label: props.xAxisLabel(),
          stroke: styles.textColor,
          font: "14px Sora, sans-serif",
          labelFont: "600 15px Sora, sans-serif",
          splits: scale === "log"
            ? (_u, _axisIdx, scaleMin, scaleMax) => logDollarAxisSplits(scaleMin, scaleMax)
            : undefined,
          filter: (_u, splits) => scale === "log"
            ? filterLogDollarAxisSplits(splits)
            : filterDollarAxisSplits(splits),
          values: (_u, splits) => formatFilteredAxisValues(splits, formatDollarTick),
          grid: {
            stroke: styles.gridColor,
            width: 0.5,
            // Log axes have many minor splits; only draw grid lines where a
            // labeled dollar tick is actually rendered. Linear axes retain
            // their existing formatting and split policy.
            filter: (_u, splits) => scale === "log"
              ? filterLogDollarAxisSplits(splits)
              : filterDollarAxisSplits(splits),
          },
        },
        {
          label: props.yAxisLabel(),
          stroke: styles.textColor,
          font: "14px Sora, sans-serif",
          labelFont: "600 15px Sora, sans-serif",
          // Reserve enough width for the widest formatted tick, plus a
          // deliberate gap between those ticks and the rotated title. The
          // callback is important on narrow CursorBench charts where the
          // percentage labels can be wider than the default uPlot estimate.
          size: (_u, values) => Math.max(
            72,
            ...(values ?? []).map((value) => String(value).length * 8 + 18),
          ),
          // Keep the rotated title close to the tick labels without
          // crowding the widest percentage value, including on phones.
          labelSize: 40,
          labelGap: 8,
          filter: (_u, splits) => /intelligence/i.test(props.yAxisLabel())
            ? filterIntelligenceAxisSplits(splits)
            : filterIntegerAxisSplits(splits),
          values: (_u, splits) => formatFilteredAxisValues(
            splits,
            (value) => /score/i.test(props.yAxisLabel()) ? formatPercentTick(value) : String(value),
          ),
          grid: {
            stroke: styles.gridColor,
            width: 0.5,
            filter: (_u, splits) => filterTenPointGridSplits(splits),
          },
        },
      ],
      legend: { show: false },
      cursor: {
        drag: { x: false, y: false },
        // uPlot's default is nearest-in-X, which is not a dot hit test.
        dataIdx: (u, seriesIndex) => {
          if (seriesIndex === 0) return u.cursor.idx ?? null;
          return hoveredTarget(u)?.dataIndex ?? null;
        },
      },
      series: [
        {},
        ...currentSeries.variantGroups.map((group) => ({
          label: `${group.baseLabel} effort variants`,
          stroke: groupColor(group.key, styles.dark),
          width: 1.5,
          alpha: 0.62,
          points: { show: false },
        })),
        ...pointGroups.map((groupKey) => {
          const color = groupColor(groupKey, styles.dark);
          return {
            label: `${groupKey} models`,
            stroke: color,
            width: 0,
            points: { show: true, size: DOT_SIZE, width: POINT_STROKE_WIDTH, stroke: color, fill: color },
          };
        }),

        {
          label: "Pareto frontier",
          // This is the last series so uPlot paints the opaque frontier above
          // every model-family connector.
          stroke: props.showFrontier?.() ?? false ? styles.frontierColor : "rgba(0,0,0,0)",
          width: 2,
          alpha: 1,
          dash: [5, 4],
          points: { show: false },
        },
      ],
      hooks: {
        ready: [(u) => { applyCrosshairDirections(u); scheduleLabelPositions(); }],
        setCursor: [
          (u) => {
            applyCrosshairDirections(u);
            const pointer = u.cursor.left === null || u.cursor.top === null ? undefined : cursorPosition(u);
            const rawPlotPointer = pointerEventPosition(u) ?? (() => {
              const over = container?.querySelector<HTMLElement>(".u-over");
              const parent = container?.parentElement;
              const parentRect = parent?.getBoundingClientRect();
              const overRect = over?.getBoundingClientRect();
              return pointer && parentRect && overRect
                ? {
                    left: pointer.left - (overRect.left - parentRect.left),
                    top: pointer.top - (overRect.top - parentRect.top),
                  }
                : undefined;
            })();
            const rawPointer = rawPlotPointer ? plotPosition(rawPlotPointer.left, rawPlotPointer.top) : pointer;
            const target = hoveredTarget(u, rawPlotPointer);
            // A direct dot hit wins over the padded label bounds. This keeps
            // one deterministic owner as the pointer crosses a label's edge.
            if (target && hoveredConnectorId === null) updateLabelHover(undefined);
            else updateLabelHover(rawPointer);
            // Labels and connector hit lines own family emphasis only. They
            // never promote a nearby dot into a second tooltip/de-emphasis
            // state while their overlay remains under the pointer.
            if ((hoveredLabelId() !== null && !target) || hoveredConnectorId !== null) {
              if (rawPlotPointer) {
                u.setCursor(rawPlotPointer, false);
                applyCrosshairDirections(u, rawPlotPointer);
              }
              hoveredIndex = null;
              clearHoveredPoint();
              props.onHover?.(null);
              return;
            }
            hoveredIndex = target && target.pointIndex >= 0 ? target.pointIndex : null;
            if (!target || hoveredIndex === null) {
              // A prior hit snaps the crosshair to the dot. Restore the raw
              // .u-over position when it leaves the hit radius so guides do
              // not remain frozen at the last hovered point.
              if (rawPlotPointer && (
                Math.abs((u.cursor.left ?? rawPlotPointer.left) - rawPlotPointer.left) > 0.5 ||
                Math.abs((u.cursor.top ?? rawPlotPointer.top) - rawPlotPointer.top) > 0.5
              )) {
                u.setCursor(rawPlotPointer, false);
                applyCrosshairDirections(u, rawPlotPointer);
              }
              clearHoveredPoint();
              props.onHover?.(null);
            } else {
              const dot = plotPosition(target.plotLeft, target.plotTop);
              publishHoveredPosition(dot ?? null);
              publishHoveredReadout(target, dot);
              // Keep guides centered on whichever dot was hit, including the
              // pre-discount endpoint, while the tooltip stays at the pointer.
              if (Math.abs((u.cursor.left ?? target.plotLeft) - target.plotLeft) > 0.5 ||
                  Math.abs((u.cursor.top ?? target.plotTop) - target.plotTop) > 0.5) {
                u.setCursor({ left: target.plotLeft, top: target.plotTop }, false);
                applyCrosshairDirections(u);
              }
              props.onHover?.(target.id, rawPointer ?? dot);
            }
          },
        ],
      },
    };
  };

  const chartHeight = () => props.height ?? (typeof window !== "undefined" && window.innerWidth < 640 ? 520 : 700);

  const applyPlotEmphasis = () => {
    const root = container?.querySelector<HTMLElement>(".uplot");
    const focusedId = hoveredLabelId();
    const focused = focusedId !== null;
    const pointGroupKeys = [...new Set(currentSeries.groupKeys)];
    const focusedConnectorIndex = focusedId === null
      ? null
      : currentSeries.variantGroups.findIndex((group) =>
          group.members.some((member) => member.id === focusedId),
        );
    const focusedVariantGroup = focusedConnectorIndex === null || focusedConnectorIndex < 0
      ? undefined
      : currentSeries.variantGroups[focusedConnectorIndex];
    const focusedPointGroupKeys = focusedVariantGroup
      ? new Set(focusedVariantGroup.members.map((member) => {
          const index = currentSeries.ids.indexOf(member.id);
          return index < 0 ? null : currentSeries.groupKeys[index];
        }).filter((key): key is string => key !== undefined && key !== null))
      : focusedId === null
        ? null
        : new Set([currentSeries.groupKeys[currentSeries.ids.indexOf(focusedId)]].filter(
            (key): key is string => key !== undefined,
          ));
    // Dim uPlot series individually instead of the whole canvas. The latter
    // also dims grid/axis pixels; series alpha leaves axes and their labels
    // fully readable. Keep every point and solid connector series belonging
    // to the focused effort family at its normal alpha.
    if (plot) {
      const alphas = seriesAlphasForFocus(
        baseSeriesAlphas,
        focused,
        currentSeries.variantGroups.length,
        0,
        pointGroupKeys,
        focusedConnectorIndex !== null && focusedConnectorIndex >= 0 ? focusedConnectorIndex : null,
        focusedPointGroupKeys,
      );
      if (emphasisAnimationFrame !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(emphasisAnimationFrame);
        emphasisAnimationFrame = null;
      }
      const current = plot;
      const from = current.series.map((series) => series.alpha ?? 1);
      const needsAnimation = current.series.some((series, index) =>
        Math.abs((series.alpha ?? 1) - (alphas[index] ?? 1)) > 0.001,
      );
      if (!needsAnimation) return;
      if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
        current.series.forEach((series, index) => { series.alpha = alphas[index] ?? 1; });
        current.redraw(false, false);
      } else {
        const startedAt = performance.now();
        const animate = (timestamp: number) => {
          if (plot !== current) return;
          const progress = Math.min(1, Math.max(0, (timestamp - startedAt) / EMPHASIS_TRANSITION_DURATION));
          const eased = 1 - (1 - progress) ** 3;
          current.series.forEach((series, index) => {
            const start = from[index] ?? 1;
            const end = alphas[index] ?? 1;
            series.alpha = start + (end - start) * eased;
          });
          current.redraw(false, false);
          if (progress < 1) {
            emphasisAnimationFrame = window.requestAnimationFrame(animate);
          } else {
            emphasisAnimationFrame = null;
          }
        };
        emphasisAnimationFrame = window.requestAnimationFrame(animate);
      }
    }
    root?.querySelectorAll<HTMLElement>(".u-axis, .u-title, .u-value, .u-label").forEach((axis) => {
      axis.style.opacity = "1";
    });
  };

  const createPlot = () => {
    if (!container) return;
    const hoveredId = hoveredIndex === null ? null : currentSeries.ids[hoveredIndex];
    const scrollY = typeof window !== "undefined" ? window.scrollY : 0;
    refreshSeries();
    setPlotXSnapshot(currentSeries.x.join(","));
    plot?.destroy();
    if (plotAnimationFrame !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(plotAnimationFrame);
      plotAnimationFrame = null;
    }
    const initialData = dataFor();
    plot = new uPlot(buildOptions(), initialData, container);
    previousPlotData = { shape: plotDataShape() };
    setPlotRevision((revision) => revision + 1);
    baseSeriesAlphas = plot.series.map((series) => series.alpha ?? 1);
    applyPlotEmphasis();
    hoveredIndex = hoveredId === undefined || hoveredId === null
      ? null
      : currentSeries.ids.indexOf(hoveredId);
    publishHoveredPosition(hoveredIndex === null || hoveredIndex < 0
      ? null
      : pointPosition(plot, hoveredIndex) ?? null);
    if (typeof window !== "undefined" && window.scrollY !== scrollY) window.scrollTo(window.scrollX, scrollY);
    setPlotRevision((revision) => revision + 1);
    scheduleLabelPositions();
  };

  onMount(() => {
    createPlot();

    // Overlay labels and uPlot's canvas are separate event surfaces. A
    // document-level boundary check guarantees stale guides are cleared when
    // the pointer leaves above/right (or any other edge) without relying on a
    // particular child surface to dispatch a leave event.
    const clearWhenOutside = (event: MouseEvent) => {
      const root = container?.parentElement;
      const rect = root?.getBoundingClientRect();
      if (!rect) return;
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) {
        clearPointerInteraction();
      }
    };
    document.addEventListener("pointermove", clearWhenOutside, true);
    document.addEventListener("mousemove", clearWhenOutside, true);
    document.addEventListener("pointerout", clearWhenOutside, true);
    document.addEventListener("mouseout", clearWhenOutside, true);
    onCleanup(() => {
      document.removeEventListener("pointermove", clearWhenOutside, true);
      document.removeEventListener("mousemove", clearWhenOutside, true);
      document.removeEventListener("pointerout", clearWhenOutside, true);
      document.removeEventListener("mouseout", clearWhenOutside, true);
    });

    const resize = () => {
      if (!container || !plot) return;
      plot.setSize({ width: container.clientWidth, height: chartHeight() });
      setPlotRevision((revision) => revision + 1);
      scheduleLabelPositions();
    };
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(resize);
      if (container) ro.observe(container);
      onCleanup(() => ro.disconnect());
    } else {
      window.addEventListener("resize", resize);
      onCleanup(() => window.removeEventListener("resize", resize));
    }

    const onThemeChange = () => createPlot();
    window.addEventListener("bench-bus-theme-change", onThemeChange);
    onCleanup(() => {
      window.removeEventListener("bench-bus-theme-change", onThemeChange);
    });

    onCleanup(() => {
      plot?.destroy();
      plot = null;
    });
  });

  // Axis scale changes uPlot's distr, which is construction-time only.
  createEffect(on(() => props.scale(), createPlot, { defer: true }));

  const animatePlotData = (nextData: uPlot.AlignedData, nextShape: PlotDataShape) => {
    if (!plot) return;
    if (plotAnimationFrame !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(plotAnimationFrame);
      plotAnimationFrame = null;
    }
    const fromSnapshot = previousPlotData;
    if (fromSnapshot === null || typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      plot.setData(nextData);
      previousPlotData = { shape: nextShape };
      return;
    }

    // A second toggle can arrive before the first animation completes. Use
    // uPlot's live interpolated frame as the source so rapid toggles do not
    // snap back to the previous destination.
    const fromData = plot.data;
    const fromShape = fromSnapshot.shape;
    const oldPathIndexes = new Map(fromShape.pathSlots.map((slot, index) => [slot, index]));
    const oldPointIndexes = new Map(fromShape.pointIds.map((id, index) => [id, index]));
    const oldConnectorRows = new Map(fromShape.connectorGroupKeys.map((key, index) => [key, 1 + index]));
    const oldPointRows = new Map(fromShape.pointGroupKeys.map((key, index) => [key, 1 + fromShape.connectorGroupKeys.length + index]));
    const oldActualOffset = fromShape.pathSlots.length;
    const nextActualOffset = nextShape.pathSlots.length;
    const nextConnectorStart = 1;
    const nextPointStart = nextConnectorStart + nextShape.connectorGroupKeys.length;
    const nextFrontierRow = nextData.length - 1;

    const previousValue = (rowIndex: number, valueIndex: number): number | null | undefined => {
      let oldRowIndex: number | undefined;
      let oldValueIndex: number | undefined;
      if (rowIndex === 0) {
        if (valueIndex < nextActualOffset) {
          oldValueIndex = oldPathIndexes.get(nextShape.pathSlots[valueIndex]!);
        } else {
          const pointIndex = oldPointIndexes.get(nextShape.pointIds[valueIndex - nextActualOffset]!);
          oldValueIndex = pointIndex === undefined ? undefined : oldActualOffset + pointIndex;
        }
        oldRowIndex = 0;
      } else if (rowIndex >= nextConnectorStart && rowIndex < nextPointStart) {
        const groupKey = nextShape.connectorGroupKeys[rowIndex - nextConnectorStart];
        oldRowIndex = groupKey === undefined ? undefined : oldConnectorRows.get(groupKey);
        oldValueIndex = oldPathIndexes.get(nextShape.pathSlots[valueIndex]!);
      } else if (rowIndex >= nextPointStart && rowIndex < nextFrontierRow) {
        const groupKey = nextShape.pointGroupKeys[rowIndex - nextPointStart];
        oldRowIndex = groupKey === undefined ? undefined : oldPointRows.get(groupKey);
        const pointIndex = oldPointIndexes.get(nextShape.pointIds[valueIndex - nextActualOffset]!);
        oldValueIndex = pointIndex === undefined ? undefined : oldActualOffset + pointIndex;
      } else if (rowIndex === nextFrontierRow && valueIndex < nextActualOffset) {
        oldRowIndex = fromData.length - 1;
        oldValueIndex = oldPathIndexes.get(nextShape.pathSlots[valueIndex]!);
      }
      return oldRowIndex === undefined || oldValueIndex === undefined
        ? undefined
        : (fromData[oldRowIndex] as ArrayLike<number | null> | undefined)?.[oldValueIndex];
    };

    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    const frame = (timestamp: number) => {
      if (!plot) return;
      const progress = Math.min(1, Math.max(0, (timestamp - startedAt) / PLOT_ANIMATION_DURATION));
      const eased = 1 - (1 - progress) ** 3;
      const interpolated = nextData.map((series, seriesIndex) =>
        Array.from(series as ArrayLike<number | null>, (value, valueIndex) => {
          const oldValue = previousValue(seriesIndex, valueIndex);
          return typeof value === "number" && typeof oldValue === "number"
            ? oldValue + (value - oldValue) * eased
            : value;
        }),
      ) as unknown as uPlot.AlignedData;
      plot.setData(interpolated);
      // The canvas moves with uPlot's interpolated data. Rebuild the SVG/HTML
      // overlay from that same frame so labels, crowns, and connector hit
      // targets travel with the dots instead of jumping to the destination.
      updateLabelPositions();
      setPlotRevision((revision) => revision + 1);
      if (progress < 1) {
        plotAnimationFrame = window.requestAnimationFrame(frame);
      } else {
        plotAnimationFrame = null;
        previousPlotData = { shape: nextShape };
      }
    };
    plotAnimationFrame = window.requestAnimationFrame(frame);
  };

  const applyPlotData = () => {
    const hoveredId = hoveredIndex === null ? null : currentSeries.ids[hoveredIndex];
    refreshSeries();
    setPlotXSnapshot(currentSeries.x.join(","));
    const data = dataFor();
    const shape = plotDataShape();
    hoveredIndex = hoveredId === undefined || hoveredId === null
      ? null
      : currentSeries.ids.indexOf(hoveredId);
    const nextStructureKey = `${currentSeries.discounts.length}|${currentSeries.variantGroups
      .map((group) => `${group.key}:${group.members.length}`)
      .join("|")}|${[...new Set(currentSeries.groupKeys)].join("|")}`;
    if (!plot || nextStructureKey !== plotStructureKey) createPlot();
    else {
      animatePlotData(data, shape);
      setPlotRevision((revision) => revision + 1);
      hoveredIndex = hoveredId === undefined || hoveredId === null
        ? null
        : currentSeries.ids.indexOf(hoveredId);
      publishHoveredPosition(hoveredIndex === null || hoveredIndex < 0
        ? null
        : pointPosition(plot, hoveredIndex) ?? null);
    }
    setPlotRevision((revision) => revision + 1);
    scheduleLabelPositions();
  };

  // Slider input can arrive much faster than a frame. Coalesce pending
  // updates so uPlot only allocates one bounded data set per rendered frame;
  // the callback always reads the latest reactive points when it runs.
  const schedulePlotData = () => {
    if (plotUpdateFrame !== null) return;
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      applyPlotData();
      return;
    }
    plotUpdateFrame = window.requestAnimationFrame(() => {
      plotUpdateFrame = null;
      applyPlotData();
    });
  };

  createEffect(
    on(
      () => [props.points(), props.showFrontier?.() ?? false, props.showDiscounts?.() ?? true] as const,
      schedulePlotData,
      { defer: true },
    ),
  );

  onCleanup(() => {
    if (typeof window !== "undefined") {
      if (plotUpdateFrame !== null) window.cancelAnimationFrame(plotUpdateFrame);
      if (plotAnimationFrame !== null) window.cancelAnimationFrame(plotAnimationFrame);
      if (emphasisAnimationFrame !== null) window.cancelAnimationFrame(emphasisAnimationFrame);
      if (labelUpdateFrame !== null) window.cancelAnimationFrame(labelUpdateFrame);
    }
    plotUpdateFrame = null;
    emphasisAnimationFrame = null;
    labelUpdateFrame = null;
  });

  createEffect(
    on(
      () => props.showCrowns?.() ?? true,
      () => scheduleLabelPositions(),
      { defer: true },
    ),
  );

  createEffect(
    on(
      () => props.showLabels?.() ?? true,
      (showLabels) => {
        if (!showLabels) {
          // A hidden label cannot remain the source of family emphasis. Clear
          // the DOM hover bounds before rebuilding the overlay so the next
          // label-enabled render starts neutral too.
          hoveredLabelBounds = null;
          setHoveredLabelId(null);
        }
        scheduleLabelPositions();
      },
      { defer: true },
    ),
  );

  createEffect(on(() => [props.xAxisLabel(), props.yAxisLabel()] as const, createPlot, { defer: true }));

  createEffect(() => {
    hoveredLabelId();
    applyPlotEmphasis();
  });

  const connectorHitGeometry = createMemo(() => {
    // This dependency is the synchronization boundary between uPlot's
    // imperative data lifecycle and Solid's declarative SVG overlays.
    plotRevision();
    if (!plot) return [] as { x1: number; y1: number; x2: number; y2: number; representativeId: string }[];
    const currentPlot = plot;
    return currentSeries.variantGroups.flatMap((group) => {
      const points = group.members
        .map((member) => {
          const index = currentSeries.ids.indexOf(member.id);
          return index < 0 ? null : pointPosition(currentPlot, index);
        })
        .filter((position): position is { left: number; top: number } => position !== undefined && position !== null);
      return points.slice(1).flatMap((point, index) => {
        const segment = trimConnectorHitSegment(points[index]!, point);
        return segment ? [{ ...segment, representativeId: group.representativeId }] : [];
      });
    });
  });

  const isFocusedFamilyId = (id: string): boolean => {
    const focusedId = hoveredLabelId();
    if (focusedId === null) return true;
    const group = currentSeries.variantGroups.find((candidate) =>
      candidate.members.some((member) => member.id === focusedId),
    );
    return group ? group.members.some((member) => member.id === id) : focusedId === id;
  };

  const focusedGeometry = createMemo(() => {
    plotRevision();
    const id = hoveredLabelId();
    const labels = labelPositions();
    if (id === null || !plot || !labels.some((label) => label.id === id)) return null;
    const index = currentSeries.ids.indexOf(id);
    if (index < 0) return null;
    const currentPlot = plot;
    const point = pointPosition(currentPlot, index);
    if (!point) return null;
    const dark = themeStyles().dark;
    const connectors: { x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
    const group = currentSeries.variantGroups.find((candidate) =>
      candidate.members.some((member) => member.id === id),
    );
    const familyDots = (group?.members ?? [{ id }]).flatMap((member) => {
      const memberIndex = currentSeries.ids.indexOf(member.id);
      const position = memberIndex < 0 ? null : pointPosition(currentPlot, memberIndex);
      if (!position) return [];
      return [{
        ...position,
        id: member.id,
        color: groupColor(
          currentSeries.groupKeys[memberIndex] ?? modelGroupKey(currentSeries.labels[memberIndex] ?? member.id, member.id),
          dark,
        ),
      }];
    });
    if (group) {
      const memberPoints = group.members
        .map((member) => {
          const memberIndex = currentSeries.ids.indexOf(member.id);
          return memberIndex < 0 ? null : pointPosition(currentPlot, memberIndex);
        })
        .filter((position): position is { left: number; top: number } => position !== undefined && position !== null);
      for (let memberIndex = 1; memberIndex < memberPoints.length; memberIndex += 1) {
        const previous = memberPoints[memberIndex - 1]!;
        const current = memberPoints[memberIndex]!;
        connectors.push({
          x1: previous.left,
          y1: previous.top,
          x2: current.left,
          y2: current.top,
          color: groupColor(group.key, dark),
        });
      }
    }
    return {
      point,
      pointColor: groupColor(currentSeries.groupKeys[index] ?? modelGroupKey(currentSeries.labels[index] ?? id, id), dark),
      familyDots,
      connectors,
    };
  });

  /** Keep cursor state alive while labels/connectors (outside .u-over) own the pointer. */
  const handleOverlayPointerMove = (event: PointerEvent) => {
    if (!plot) return;
    const over = container?.querySelector<HTMLElement>(".u-over");
    if (!over) return;
    const overRect = over.getBoundingClientRect();
    const rawPlotPointer = {
      left: event.clientX - overRect.left,
      top: event.clientY - overRect.top,
    };
    const targetElement = event.target instanceof Element ? event.target : null;
    const isChartOverlayTarget = targetElement?.closest(
      "[data-testid='model-label'], [data-testid='family-connector-hit'], [data-testid='discount-line-hit']",
    ) !== null;
    // These overlays own their complete interaction lifecycle. Letting the
    // root pointer handler re-run dot snapping here can replace a crown or
    // discount-endpoint tooltip with the neighboring plotted dot.
    if (targetElement?.closest("[data-testid='pareto-crown'], [data-testid='discount-endpoint-hit']")) return;
    // The chart root is larger than uPlot's actual plot surface because it
    // also contains labels, watermark, and axis space. Pointer movement in
    // that empty right/bottom gutter must clear the guides rather than feed
    // an out-of-bounds position back into uPlot. Labels/connectors remain
    // valid overlay targets even when they sit just outside .u-over.
    if (!isChartOverlayTarget && (
      rawPlotPointer.left < 0 || rawPlotPointer.left > overRect.width ||
      rawPlotPointer.top < 0 || rawPlotPointer.top > overRect.height
    )) {
      clearPointerInteraction();
      return;
    }
    const rawPointer = plotPosition(rawPlotPointer.left, rawPlotPointer.top);
    const target = hoveredTarget(plot, rawPlotPointer);
    // Prefer the actual dot hit over the label's generous pointer padding;
    // labels remain passive when no dot owns this pointer location.
    if (target && hoveredConnectorId === null) updateLabelHover(undefined);
    else updateLabelHover(rawPointer);
    // Keep label/connector hover passive with respect to dot ownership while
    // still moving the raw guides with the pointer.
    if ((hoveredLabelId() !== null && !target) || hoveredConnectorId !== null) {
      plot.setCursor(rawPlotPointer, false);
      applyCrosshairDirections(plot, rawPlotPointer);
      hoveredIndex = null;
      clearHoveredPoint();
      props.onHover?.(null);
      return;
    }
    hoveredIndex = target && target.pointIndex >= 0 ? target.pointIndex : null;
    if (!target || hoveredIndex === null) {
      plot.setCursor(rawPlotPointer, false);
      applyCrosshairDirections(plot, rawPlotPointer);
      clearHoveredPoint();
      props.onHover?.(null);
      return;
    }
    const dot = plotPosition(target.plotLeft, target.plotTop);
    plot.setCursor({ left: target.plotLeft, top: target.plotTop }, false);
    applyCrosshairDirections(plot, { left: target.plotLeft, top: target.plotTop });
    publishHoveredPosition(dot ?? null);
    publishHoveredReadout(target, dot);
    props.onHover?.(target.id, rawPointer ?? dot);
  };

  const handleChartClick = (event: MouseEvent) => {
    if (!plot) return;
    const targetElement = event.target instanceof Element ? event.target : null;
    const discountEndpoint = targetElement?.closest("[data-testid='discount-endpoint-hit']");
    const discountEndpointId = discountEndpoint?.getAttribute("data-discount-id");
    if (discountEndpointId) {
      props.onSelectPoint?.(discountEndpointId);
      return;
    }
    // Labels, family connectors, discount lines, and crowns own their own
    // interaction. A discount endpoint remains a valid model-dot target.
    if (targetElement?.closest(
      "[data-testid='pareto-crown'], [data-testid='discount-line-hit'], [data-testid='family-connector-hit'], [data-testid='model-label']",
    )) return;
    const over = container?.querySelector<HTMLElement>(".u-over");
    if (!over || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const overRect = over.getBoundingClientRect();
    const target = hoveredTarget(plot, {
      left: event.clientX - overRect.left,
      top: event.clientY - overRect.top,
    });
    if (target) props.onSelectPoint?.(target.id);
  };

  return (
    <div
      class="relative w-full"
      onPointerMove={handleOverlayPointerMove}
      onClick={handleChartClick}
      onPointerLeave={clearPointerInteraction}
      onMouseLeave={clearPointerInteraction}
      data-hovered-label-id={hoveredLabelId() ?? undefined}
      role="group"
      aria-label={`Scatter chart of ${props.yAxisLabel()} versus ${props.xAxisLabel()}`}
      data-testid="benchmark-scatter"
    >
      <div
        ref={container}
        class="w-full"
        data-testid="benchmark-scatter-plot"
        data-plot-x={plotXSnapshot()}
      />
      <svg
        class="pointer-events-none absolute inset-0 z-1 overflow-visible"
        data-testid="chart-decorations"
      >
        <Show when={hoveredPosition()}>
          {(position) => (
            <circle
              cx={position().left}
              cy={position().top}
              r={HOVER_RING_RADIUS}
              fill="none"
              stroke="var(--color-base-content)"
              stroke-width="2"
              vector-effect="non-scaling-stroke"
              data-testid="hovered-dot"
              data-testid-hover-ring="true"
            />
          )}
        </Show>
        <Show when={hoveredAxisReadout()}>
          {(readout) => {
            const costText = `$${readout().cost.toFixed(2)}`;
            const scoreText = `${readout().score.toFixed(1)}%`;
            return (
              <g
                data-testid="hover-axis-readouts"
                fill="var(--color-base-100)"
                stroke="var(--color-base-300)"
                stroke-width="0.75"
                style={{ "pointer-events": "none" }}
              >
                <g data-axis="x" data-axis-end="axis" transform={`translate(${readout().left} ${readout().axisBottom + 4})`}>
                  <rect x="-38" y="-12" width="76" height="18" rx="3" opacity="0.92" />
                  <text x="0" y="1" fill={readout().color} stroke="none" text-anchor="middle" font-size="14">{costText}</text>
                </g>
                <g data-axis="y" data-axis-end="axis" transform={`translate(${readout().axisLeft - 8} ${readout().top})`}>
                  <rect x="-66" y="-12" width="64" height="18" rx="3" opacity="0.92" />
                  <text x="-5" y="1" fill={readout().color} stroke="none" text-anchor="end" font-size="14">{scoreText}</text>
                </g>
              </g>
            );
          }}
        </Show>
        <For each={connectorHitGeometry()}>
          {(segment) => (
            <line
              x1={segment.x1}
              y1={segment.y1}
              x2={segment.x2}
              y2={segment.y2}
              stroke="transparent"
              stroke-width="12"
              style={{ "pointer-events": "stroke" }}
              data-testid="family-connector-hit"
              data-model-id={segment.representativeId}
              onMouseEnter={() => setConnectorHover(segment.representativeId)}
              onMouseLeave={() => clearConnectorHover(segment.representativeId)}
            />
          )}
        </For>
        <Show when={focusedGeometry()}>
          {(focused) => (
            <>
              <For each={focused().connectors}>
                {(segment) => (
                  <line
                    x1={segment.x1}
                    y1={segment.y1}
                    x2={segment.x2}
                    y2={segment.y2}
                    stroke={segment.color}
                    stroke-width="2"
                    data-testid="focused-connector"
                  />
                )}
              </For>

              <For each={focused().familyDots}>
                {(dot) => (
                  <circle
                    cx={dot.left}
                    cy={dot.top}
                    r={MODEL_DOT_RADIUS}
                    fill={dot.color}
                    stroke={dot.color}
                    stroke-width={POINT_STROKE_WIDTH}
                    data-testid="focused-model-dot"
                    data-model-id={dot.id}
                  />
                )}
              </For>
            </>
          )}
        </Show>
        <For each={discountDecorations()}>
          {(discount) => {
            // Paint the dotted connector underneath the solid endpoint dot;
            // a zero gap keeps the fixed outer runs attached to the dot edges.
            const connector = discountConnectorGeometry(discount.preLeft, discount.effectiveLeft, 0);
            return (
              <g
                fill="none"
                stroke={discount.color}
                stroke-width="1.75"
                stroke-dasharray="0.1 5"
                stroke-linecap="round"
                stroke-linejoin="round"
                data-testid="discount-line"
                data-discount-id={discount.id}
                data-discount-percentage={discount.percentage}
                data-discount-provider-role={discount.providerRole ?? "plotted"}
                opacity={isFocusedFamilyId(discount.pointId) ? 0.75 : 0.2}
                style={{ transition: "opacity 140ms ease-out" }}
              >
                {/* Fixed endpoint runs leave a scale-independent open middle. */}
                <For each={connector.segments}>
                  {(segment) => (
                    <line
                      x1={segment.x1}
                      y1={discount.top}
                      x2={segment.x2}
                      y2={discount.top}
                      style={{ transition: "x1 180ms ease-out, x2 180ms ease-out, y1 180ms ease-out, y2 180ms ease-out" }}
                      data-testid="discount-line-segment"
                      data-discount-part="segment"
                    />
                  )}
                </For>
                {connector.arrowhead && (
                  <path
                    d={discountArrowheadPath(
                      connector.arrowhead.tipX,
                      discount.top,
                      connector.arrowhead.wingX,
                    )}
                    stroke-dasharray="none"
                    data-testid="discount-line-arrowhead"
                    data-discount-part="arrowhead"
                  />
                )}
                {connector.tick && (
                  <line
                    x1={connector.tick.x}
                    y1={discount.top - connector.tick.halfHeight}
                    x2={connector.tick.x}
                    y2={discount.top + connector.tick.halfHeight}
                    stroke-dasharray="none"
                    data-testid="discount-line-tick"
                    data-discount-part="tick"
                  />
                )}
                {/* The pre-discount endpoint is hollow (background-filled,
                    color-outlined) to contrast with the solid discounted dot
                    while keeping the family color identity. Explicitly reset
                    circle dashing so the outline cannot be cut into chunks. */}
                <circle
                  cx={discount.preLeft}
                  cy={discount.top}
                  r={MODEL_DOT_RADIUS}
                  fill="var(--color-base-100)"
                  stroke={discount.color}
                  stroke-width={POINT_STROKE_WIDTH}
                  stroke-dasharray="none"
                  data-testid="discount-endpoint-dot"
                  data-discount-endpoint="pre"
                  style={{
                    "pointer-events": "none",
                    transition: "cx 180ms ease-out, cy 180ms ease-out",
                  }}
                />
              </g>
            );
          }}
        </For>
      </svg>
      {/* Keep discount lines interactive without making the SVG decoration
          layer capture pointer movement from the uPlot surface. */}
      <For each={discountDecorations()}>
        {(discount) => {
          const segment = trimDiscountSegment(discount.preLeft, discount.effectiveLeft);
          return (
            <>
              {segment && (
                <span
                  class="pointer-events-auto absolute z-2"
                  style={{
                    left: `${Math.min(segment.x1, segment.x2)}px`,
                    top: `${discount.top - DISCOUNT_HIT_RADIUS}px`,
                    width: `${Math.abs(segment.x2 - segment.x1)}px`,
                    height: `${DISCOUNT_HIT_RADIUS * 2}px`,
                    transition: "left 180ms ease-out, top 180ms ease-out, width 180ms ease-out",
                  }}
                  data-testid="discount-line-hit"
                  data-discount-id={discount.id}
                  onMouseEnter={() => setConnectorHover(discount.pointId)}
                  onMouseLeave={() => clearConnectorHover(discount.pointId)}
                />
              )}
              <span
                class="pointer-events-auto absolute z-3"
                style={{
                  left: `${discount.preLeft - DOT_HIT_RADIUS}px`,
                  top: `${discount.top - DOT_HIT_RADIUS}px`,
                  width: `${DOT_HIT_RADIUS * 2}px`,
                  height: `${DOT_HIT_RADIUS * 2}px`,
                  transition: "left 180ms ease-out, top 180ms ease-out",
                }}
                data-testid="discount-endpoint-hit"
                data-discount-id={discount.id}
                data-discount-endpoint="pre"
                onMouseEnter={() => setDiscountEndpointHover(discount)}
                onMouseLeave={() => clearDiscountEndpointHover(`${discount.id}:pre`)}
              />
            </>
          );
        }}
      </For>
      {/* HTML crown hit targets sit above the canvas without making the full
          SVG decoration layer intercept pointer movement from the plot. */}
      <For each={pointDecorations()}>
        {(point) => {
          const description = `${point.modelLabel} is on the Pareto frontier, meaning no plotted model is both cheaper and higher-scoring.`;
          return (
            <span
              class="pointer-events-auto absolute z-10 inline-flex h-[18px] w-[18px] items-center justify-center"
              style={{
                left: `${point.left - 9}px`,
                top: `${point.top - 27}px`,
                color: themeStyles().textColor,
                opacity: isFocusedFamilyId(point.id) ? 1 : 0.2,
                transition: "left 180ms ease-out, top 180ms ease-out, opacity 140ms ease-out",
              }}
              role="img"
              aria-label={description}
              title={description}
              tabIndex="0"
              onMouseEnter={() => {
                // Crown hit targets sit above the plot, so the underlying
                // uPlot surface cannot clear a dot hover when the pointer
                // moves upward into the crown.
                clearPointerInteraction();
                setHoveredCrownId(point.id);
              }}
              onMouseLeave={() => setHoveredCrownId(null)}
              onFocus={() => {
                clearPointerInteraction();
                setHoveredCrownId(point.id);
              }}
              onBlur={() => setHoveredCrownId(null)}
              data-testid="pareto-crown"
              data-model-id={point.id}
            >
              <Crown width={18} height={18} aria-hidden="true" />
            </span>
          );
        }}
      </For>
      <Show when={hoveredCrownId() !== null && pointDecorations().some((point) => point.id === hoveredCrownId())}>
        {(() => {
          const crown = pointDecorations().find((point) => point.id === hoveredCrownId());
          if (!crown) return null;
          return (
            <div
              class="pointer-events-none absolute z-20 max-w-xs rounded-box bg-base-100 px-2 py-1 text-xs shadow-lg"
              style={{ left: `${crown.left + 10}px`, top: `${Math.max(0, crown.top - 42)}px`, color: crown.color }}
              role="tooltip"
              data-testid="pareto-crown-tooltip"
            >
              {`${crown.modelLabel} is on the Pareto frontier: no plotted model is both cheaper and higher-scoring.`}
            </div>
          );
        })()}
      </Show>
      <Show when={props.showLabels?.() ?? true}>
        <svg
          class="pointer-events-none absolute inset-0 z-0 overflow-visible"
          aria-hidden="true"
          data-testid="model-label-leaders"
        >
          <For each={labelPositions()}>
            {(label) => {
              const endLeft = Math.max(label.left, Math.min(label.anchorLeft, label.left + label.width));
              const endTop = Math.max(label.top, Math.min(label.anchorTop, label.top + label.height));
              const deltaLeft = endLeft - label.anchorLeft;
              const deltaTop = endTop - label.anchorTop;
              const distance = Math.hypot(deltaLeft, deltaTop);
              // Start just beyond the rendered dot edge. The layout collision
              // pass rejects candidate segments that cross another dot/crown,
              // so this remains close without drawing through the plot.
              const directionLeft = distance > 0 ? deltaLeft / distance : 1;
              const directionTop = distance > 0 ? deltaTop / distance : 0;
              const startLeft = label.anchorLeft + directionLeft * (DOT_SIZE / 2 + LEADER_LINE_GAP);
              const startTop = label.anchorTop + directionTop * (DOT_SIZE / 2 + LEADER_LINE_GAP);
              return (
                <line
                  x1={startLeft}
                  y1={startTop}
                  x2={endLeft}
                  y2={endTop}
                  stroke={themeStyles().leaderColor}
                  stroke-opacity={isFocusedFamilyId(label.id) ? "0.5" : "0.1"}
                  stroke-width="0.75"
                  style={{ transition: "stroke-opacity 140ms ease-out" }}
                  data-testid="model-label-leader"
                />
              );
            }}
          </For>
        </svg>
        <For each={labelPositions()}>
          {(label) => (
            <span
              class="pointer-events-none absolute z-1 cursor-default whitespace-nowrap rounded bg-base-100/80 px-1 text-left text-xs leading-5 shadow-sm"
              style={{
                left: `${label.left}px`,
                top: `${label.top}px`,
                width: `${label.width}px`,
                height: `${label.height}px`,
                color: label.color,
                // Labels participate in family emphasis but never expose a
                // tooltip cursor or an additional hover circle.
                opacity: isFocusedFamilyId(label.id) ? 1 : 0.2,
                "font-size": `${LABEL_MAIN_FONT_SIZE}px`,
                "line-height": `${MODEL_LABEL_LINE_HEIGHT}px`,
                transition: "opacity 140ms ease-out",
              }}
              data-testid="model-label"
              data-model-id={label.id}
              role="img"
              aria-label={label.accessibleLabel ?? label.label}
              title={label.accessibleLabel ?? label.label}
              tabIndex="0"
              onFocus={() => setModelLabelHover(label.id)}
              onBlur={() => {
                setLabelHover(null);
                props.onHover?.(null);
              }}
            >
              <span data-testid="model-label-main">{label.mainLabel ?? label.label}</span>
              <Show when={label.discountLabel}>
                {(discountLabel) => (
                  <span
                    data-testid="model-label-discount"
                    style={{
                      "font-size": `${LABEL_DISCOUNT_FONT_SIZE}px`,
                      "font-weight": "400",
                      "line-height": "1",
                    }}
                  >
                    {` ${discountLabel()}`}
                  </span>
                )}
              </Show>
            </span>
          )}
        </For>
      </Show>
    </div>
  );
}
