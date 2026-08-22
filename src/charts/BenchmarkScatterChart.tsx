import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { Crown } from "lucide-solid";
import uPlot, { type Options } from "uplot";
import { COLOR_BLIND_CHANGE_EVENT, isColorBlindMode, isDarkTheme } from "../components/ThemeToggle";
import "uplot/dist/uPlot.min.css";
import { inferModelBrand, modelGroupColor } from "./brand";
import { modelGroupKey } from "./modelMetadata";
import {
  groupModelVariants,
  layoutModelLabels,
  type ModelVariantGroup,
  type ModelVariantMember,
} from "./labelLayout";
import {
  largestExplicitDiscountForPoint,
  modelLabelWithDiscount,
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
  showDiscounts?: () => boolean;
  height?: number;
  /** Hover changes only when the pointer is within the hit radius of a dot. */
  onHover?: (id: string | null, pos?: { left: number; top: number }) => void;
}

const DOT_SIZE = 9;
const DISCOUNT_DOT_SIZE = 7;
const MODEL_LABEL_FONT_SIZE = 13;
const MODEL_LABEL_LINE_HEIGHT = 20;
const DOT_HIT_RADIUS = 14;
const LABEL_DOT_RADIUS = 8;
const LEADER_LINE_GAP = 3;

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

/** Return the dot position only when the pointer is within the hit radius. */
export function snapToDotPosition(
  pointer: { left: number; top: number },
  dot: { left: number; top: number },
  radius = DOT_HIT_RADIUS,
): { left: number; top: number } | null {
  if (![pointer.left, pointer.top, dot.left, dot.top, radius].every(Number.isFinite) || radius < 0) return null;
  return Math.hypot(pointer.left - dot.left, pointer.top - dot.top) <= radius ? dot : null;
}

/** uPlot split filters kept pure so axis and grid policies stay regression-testable. */
export function filterDollarAxisSplits(splits: readonly number[]): (number | null)[] {
  return splits.map((value) => formatDollarTick(value) !== "" ? value : null);
}

/** Keep log-dollar powers of ten and the valid endpoints of the active range. */
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
  let labelUpdateFrame: number | null = null;
  let currentSeries: CurrentSeries = {
    x: [],
    y: [],
    ids: [],
    droppedIds: [],
    labels: [],
    effortGroups: [],
    groupKeys: [],
    brands: [],
    frontierIds: [],
    variantGroups: [],
    discounts: [],
  };
  const [labelPositions, setLabelPositions] = createSignal<ReturnType<typeof layoutModelLabels>>([]);
  const [hoveredPosition, setHoveredPosition] = createSignal<{ left: number; top: number } | null>(null);
  const [hoveredLabelId, setHoveredLabelId] = createSignal<string | null>(null);
  const [pointDecorations, setPointDecorations] = createSignal<{ id: string; left: number; top: number; color: string }[]>([]);
  const [discountDecorations, setDiscountDecorations] = createSignal<DiscountDecoration[]>([]);
  const [plotXSnapshot, setPlotXSnapshot] = createSignal("");
  let hoveredLabelBounds: { left: number; top: number; right: number; bottom: number } | null = null;
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
    const groupById = new Map(
      variantGroups.flatMap((group) => group.members.map((member) => [member.id, group.key] as const)),
    );
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
            providerRole: discount.providerRole,
          }];
        })
      : [];
    currentSeries = {
      x: orderedIds.map((id) => series.x[indexById.get(id)!]!),
      y: orderedIds.map((id) => series.y[indexById.get(id)!]!),
      ids: orderedIds,
      droppedIds: series.droppedIds,
      labels: orderedIds.map((id) => {
        const point = pointById.get(id);
        if (!point) return id;
        const discount = props.showDiscounts?.() ?? true ? largestExplicitDiscountForPoint(point) : null;
        return modelLabelWithDiscount(point.label, discount);
      }),
      effortGroups: orderedIds.map((id) => groupById.get(id) ?? null),
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

  const groupColor = (groupKey: string, dark: boolean): string =>
    modelGroupColor(groupKey, dark, isColorBlindMode());

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

  const dataFor = (): uPlot.AlignedData => {
    const pointById = new Map(
      currentSeries.ids.map((id, index) => [id, { x: currentSeries.x[index]!, y: currentSeries.y[index]! }]),
    );
    const pathIds = [
      ...currentSeries.frontierIds,
      ...currentSeries.variantGroups.flatMap((group) => group.members.map((member) => member.id)),
    ];
    const discountPathSlots = currentSeries.discounts.flatMap((discount) => [discount.preX, discount.effectiveX]);
    const pathX = [...pathIds.map((id) => pointById.get(id)?.x ?? 0), ...discountPathSlots];
    const pathLength = pathX.length;
    const discountOffset = pathLength;
    const actualOffset = discountOffset + currentSeries.discounts.length;
    const actualLength = currentSeries.ids.length;
    const dataX = [
      ...pathX,
      ...currentSeries.discounts.map((discount) => discount.preX),
      ...currentSeries.x,
    ];
    const frontierY = [
      ...(props.showFrontier?.() ?? false)
        ? currentSeries.frontierIds.map((id) => pointById.get(id)?.y ?? null)
        : new Array<number | null>(currentSeries.frontierIds.length).fill(null),
      ...new Array<number | null>(pathLength - currentSeries.frontierIds.length + currentSeries.discounts.length + actualLength).fill(null),
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
    const discountRows = currentSeries.discounts.map((discount, index) => {
      const row = new Array<number | null>(dataX.length).fill(null);
      row[currentSeries.frontierIds.length + currentSeries.variantGroups.reduce((n, group) => n + group.members.length, 0) + index * 2] = discount.y;
      row[currentSeries.frontierIds.length + currentSeries.variantGroups.reduce((n, group) => n + group.members.length, 0) + index * 2 + 1] = discount.y;
      return row;
    });
    // Keep one uPlot series per model family. The same family key drives its
    // point, effort connector, discount arrow, and selector color.
    const pointGroups = [...new Set(currentSeries.groupKeys)];
    const pointRows = pointGroups.map((groupKey) => {
      const row = new Array<number | null>(dataX.length).fill(null);
      currentSeries.groupKeys.forEach((pointGroupKey, index) => {
        if (pointGroupKey === groupKey) row[actualOffset + index] = currentSeries.y[index]!;
      });
      return row;
    });
    const discountDots = currentSeries.discounts.map((discount, index) => {
      const row = new Array<number | null>(dataX.length).fill(null);
      row[discountOffset + index] = discount.y;
      return row;
    });
    // uPlot accepts null-gapped plain arrays at runtime; its typings only
    // cover TypedArrays, so the sparse rows are cast at this boundary.
    // Pareto is deliberately the final data row so uPlot paints it above all
    // model-family connectors and discount segments.
    return [Float64Array.from(dataX), ...connectorRows, ...discountRows, ...pointRows, ...discountDots, frontierY] as unknown as uPlot.AlignedData;
  };

  type HoverTarget = {
    pointIndex: number;
    id: string;
    plotLeft: number;
    plotTop: number;
    dataIndex: number;
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

  const hoveredTarget = (u: uPlot): HoverTarget | null => {
    const pointer = pointerPlotPosition(u);
    if (!pointer) return null;
    const connectorLength = currentSeries.frontierIds.length + currentSeries.variantGroups.reduce(
      (total, group) => total + group.members.length,
      0,
    );
    const discountOffset = connectorLength + currentSeries.discounts.length * 2;
    const actualOffset = discountOffset + currentSeries.discounts.length;
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
    currentSeries.discounts.forEach((discount, index) => {
      const plotTop = u.valToPos(discount.y, "y");
      const preLeft = u.valToPos(discount.preX, "x");
      const effectiveLeft = u.valToPos(discount.effectiveX, "x");
      if (plotTop === undefined || preLeft === undefined || effectiveLeft === undefined) return;
      targets.push(
        {
          pointIndex: currentSeries.ids.indexOf(discount.pointId),
          id: discount.pointId,
          plotLeft: preLeft,
          plotTop,
          dataIndex: discountOffset + index,
          distance: Math.hypot(preLeft - pointer.left, plotTop - pointer.top),
        },
        {
          pointIndex: currentSeries.ids.indexOf(discount.pointId),
          id: discount.pointId,
          plotLeft: effectiveLeft,
          plotTop,
          dataIndex: connectorLength + index * 2 + 1,
          distance: Math.hypot(effectiveLeft - pointer.left, plotTop - pointer.top),
        },
      );
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
      const x = currentSeries.x[index];
      const y = currentSeries.y[index];
      if (x === undefined || y === undefined || !currentSeries.frontierIds.includes(id)) return [];
      return [{
        id,
        left: overRect.left - rootRect.left + currentPlot.valToPos(x, "x"),
        top: overRect.top - rootRect.top + currentPlot.valToPos(y, "y"),
        color: themeStyles().frontierColor,
      }];
    });
    const crownDots = currentSeries.ids.flatMap((id, index) => {
      const x = currentSeries.x[index];
      const y = currentSeries.y[index];
      if (x === undefined || y === undefined) return [];
      return [{
        id,
        left: overRect.left - rootRect.left + currentPlot.valToPos(x, "x"),
        top: overRect.top - rootRect.top + currentPlot.valToPos(y, "y"),
      }];
    });
    const retainedCrownIds = new Set(selectCrownPoints(allCrownDecorations, crownDots).map((crown) => crown.id));
    setPointDecorations(allCrownDecorations.filter((crown) => retainedCrownIds.has(crown.id)));
    const discountGeometry = currentSeries.discounts.flatMap((discount) => {
      const preLeft = overRect.left - rootRect.left + currentPlot.valToPos(discount.preX, "x");
      const effectiveLeft = overRect.left - rootRect.left + currentPlot.valToPos(discount.effectiveX, "x");
      const top = overRect.top - rootRect.top + currentPlot.valToPos(discount.y, "y");
      if (![preLeft, effectiveLeft, top].every(Number.isFinite)) return [];
      return [{
        id: discount.id,
        pointId: discount.pointId,
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
      const x = currentSeries.x[index];
      const y = currentSeries.y[index];
      if (x === undefined || y === undefined) return [];
      return [
        {
          id,
          label: currentSeries.labels[index] ?? id,
          anchorLeft: overRect.left - rootRect.left + currentPlot.valToPos(x, "x"),
          anchorTop: overRect.top - rootRect.top + currentPlot.valToPos(y, "y"),
          color: groupColor(currentSeries.groupKeys[index] ?? modelGroupKey(currentSeries.labels[index] ?? id, id), dark),
          priority: currentSeries.frontierIds.includes(id) ? 1 : 0,
        },
      ];
    });
    const obstacles = currentSeries.ids.flatMap((id, index) => {
      const x = currentSeries.x[index];
      const y = currentSeries.y[index];
      if (x === undefined || y === undefined) return [];
      return [{
        id,
        left: overRect.left - rootRect.left + currentPlot.valToPos(x, "x"),
        top: overRect.top - rootRect.top + currentPlot.valToPos(y, "y"),
      }];
    });
    const baseLabels = layoutModelLabels(anchors, bounds, { obstacles, lines: discountLines });
    const labels = baseLabels;
    setLabelPositions(props.showLabels?.() ?? true ? labels : []);
    // Re-read the dot position after uPlot has laid out the plot. This keeps
    // the hover emphasis centered when a scale or container size changes.
    if (hoveredIndex !== null) {
      setHoveredPosition(pointPosition(currentPlot, hoveredIndex) ?? null);
    }
  };

  const scheduleLabelPositions = () => {
    if (labelUpdateFrame !== null) return;
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      labelUpdateFrame = window.requestAnimationFrame(() => {
        labelUpdateFrame = null;
        updateLabelPositions();
      });
    } else {
      updateLabelPositions();
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
  const pointerEventPosition = (u: uPlot) => {
    const event = (u.cursor as uPlot.Cursor & { event?: MouseEvent }).event;
    const over = container?.querySelector<HTMLElement>(".u-over");
    const parent = container?.parentElement;
    if (!event || !over || !parent || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      return undefined;
    }
    const parentRect = parent.getBoundingClientRect();
    const overRect = over.getBoundingClientRect();
    return {
      left: overRect.left - parentRect.left + event.clientX - overRect.left,
      top: overRect.top - parentRect.top + event.clientY - overRect.top,
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
    const x = currentSeries.x[index];
    const y = currentSeries.y[index];
    if (x === undefined || y === undefined) return undefined;
    const plotLeft = u.valToPos(x, "x");
    const plotTop = u.valToPos(y, "y");
    if (plotLeft === undefined || plotTop === undefined) return undefined;
    return plotPosition(plotLeft, plotTop);
  };

  const updateLabelHover = (pointer: { left: number; top: number } | undefined) => {
    const currentId = hoveredLabelId();
    const padding = 10;
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

  const applyCrosshairDirections = (u: uPlot) => {
    const over = container?.querySelector<HTMLElement>(".u-over");
    const horizontal = container?.querySelector<HTMLElement>(".u-cursor-y");
    const vertical = container?.querySelector<HTMLElement>(".u-cursor-x");
    if (!over || !horizontal || !vertical) return;
    const geometry = crosshairGuideGeometry(u.cursor.left, u.cursor.top, over.clientHeight);
    horizontal.style.left = `${geometry.horizontal.left}px`;
    horizontal.style.width = `${geometry.horizontal.width}px`;
    vertical.style.left = `${geometry.vertical.left}px`;
    vertical.style.top = `${geometry.vertical.top}px`;
    vertical.style.height = `${geometry.vertical.height}px`;
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
                  const values = u.data?.[0]
                    ? Array.from(u.data[0] as ArrayLike<number>).filter(
                        (value) => Number.isFinite(value) && value > 0,
                      )
                    : [];
                  if (values.length === 0) return [min, max];
                  return [Math.min(...values) / 1.2, Math.max(...values) * 1.2];
                }
              : (u, min, max) => {
                  const values = u.data?.[0]
                    ? Array.from(u.data[0] as ArrayLike<number>).filter((value) => Number.isFinite(value))
                    : [];
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
          labelSize: 44,
          labelGap: 16,
          filter: (_u, splits) => filterIntegerAxisSplits(splits),
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
        ...currentSeries.discounts.map((discount) => ({
          label: `${discount.percentage}% discount: ${discount.providerName ?? "provider"}`,
          stroke: groupColor(discount.groupKey, styles.dark),
          width: 1,
          // Dotted, rather than solid or Pareto-dashed, so price adjustments
          // have an unambiguous visual grammar.
          dash: [1, 4],
          points: { show: false },
        })),
        ...pointGroups.map((groupKey) => {
          const color = groupColor(groupKey, styles.dark);
          return {
            label: `${groupKey} models`,
            stroke: color,
            width: 0,
            points: { show: true, size: DOT_SIZE, width: 1.5, stroke: color, fill: color },
          };
        }),
        ...currentSeries.discounts.map((discount) => ({
          label: `${discount.percentage}% discount before price`,
          stroke: groupColor(discount.groupKey, styles.dark),
          width: 0,
          points: {
            show: true,
            size: DISCOUNT_DOT_SIZE,
            width: 1.5,
            stroke: groupColor(discount.groupKey, styles.dark),
            fill: groupColor(discount.groupKey, styles.dark),
          },
        })),
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
            const rawPointer = pointerEventPosition(u) ?? pointer;
            updateLabelHover(rawPointer);
            const target = hoveredTarget(u);
            hoveredIndex = target && target.pointIndex >= 0 ? target.pointIndex : null;
            if (!target || hoveredIndex === null) {
              // A prior hit snaps the crosshair to the dot. Restore the raw
              // pointer position when it leaves the hit radius so guides do
              // not remain frozen at the last hovered point.
              if (rawPointer && (
                Math.abs((u.cursor.left ?? rawPointer.left) - rawPointer.left) > 0.5 ||
                Math.abs((u.cursor.top ?? rawPointer.top) - rawPointer.top) > 0.5
              )) {
                const over = container?.querySelector<HTMLElement>(".u-over");
                if (over) {
                  const overRect = over.getBoundingClientRect();
                  const parent = container?.parentElement;
                  const parentRect = parent?.getBoundingClientRect();
                  if (parentRect) {
                    u.setCursor({
                      left: rawPointer.left - (overRect.left - parentRect.left),
                      top: rawPointer.top - (overRect.top - parentRect.top),
                    }, false);
                    applyCrosshairDirections(u);
                  }
                }
              }
              setHoveredPosition(null);
              props.onHover?.(null);
            } else {
              const dot = plotPosition(target.plotLeft, target.plotTop);
              setHoveredPosition(dot ?? null);
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
        currentSeries.discounts.length,
        pointGroupKeys,
        focusedConnectorIndex !== null && focusedConnectorIndex >= 0 ? focusedConnectorIndex : null,
        focusedPointGroupKeys,
      );
      plot.series.forEach((series, index) => { series.alpha = alphas[index] ?? 1; });
      plot.redraw(false, false);
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
    plot = new uPlot(buildOptions(), dataFor(), container);
    baseSeriesAlphas = plot.series.map((series) => series.alpha ?? 1);
    applyPlotEmphasis();
    hoveredIndex = hoveredId === undefined || hoveredId === null
      ? null
      : currentSeries.ids.indexOf(hoveredId);
    setHoveredPosition(hoveredIndex === null || hoveredIndex < 0
      ? null
      : pointPosition(plot, hoveredIndex) ?? null);
    if (typeof window !== "undefined" && window.scrollY !== scrollY) window.scrollTo(window.scrollX, scrollY);
    scheduleLabelPositions();
  };

  onMount(() => {
    createPlot();

    const resize = () => {
      if (!container || !plot) return;
      plot.setSize({ width: container.clientWidth, height: chartHeight() });
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
    window.addEventListener(COLOR_BLIND_CHANGE_EVENT, onThemeChange);
    onCleanup(() => {
      window.removeEventListener("bench-bus-theme-change", onThemeChange);
      window.removeEventListener(COLOR_BLIND_CHANGE_EVENT, onThemeChange);
    });

    onCleanup(() => {
      plot?.destroy();
      plot = null;
    });
  });

  // Axis scale changes uPlot's distr, which is construction-time only.
  createEffect(on(() => props.scale(), createPlot, { defer: true }));

  const applyPlotData = () => {
    const hoveredId = hoveredIndex === null ? null : currentSeries.ids[hoveredIndex];
    refreshSeries();
    setPlotXSnapshot(currentSeries.x.join(","));
    const data = dataFor();
    hoveredIndex = hoveredId === undefined || hoveredId === null
      ? null
      : currentSeries.ids.indexOf(hoveredId);
    const nextStructureKey = `${currentSeries.discounts.length}|${currentSeries.variantGroups
      .map((group) => `${group.key}:${group.members.length}`)
      .join("|")}|${[...new Set(currentSeries.groupKeys)].join("|")}`;
    if (!plot || nextStructureKey !== plotStructureKey) createPlot();
    else {
      plot.setData(data);
      hoveredIndex = hoveredId === undefined || hoveredId === null
        ? null
        : currentSeries.ids.indexOf(hoveredId);
      setHoveredPosition(hoveredIndex === null || hoveredIndex < 0
        ? null
        : pointPosition(plot, hoveredIndex) ?? null);
    }
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
      if (labelUpdateFrame !== null) window.cancelAnimationFrame(labelUpdateFrame);
    }
    plotUpdateFrame = null;
    labelUpdateFrame = null;
  });

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
    if (!plot) return [] as { x1: number; y1: number; x2: number; y2: number; representativeId: string }[];
    const currentPlot = plot;
    return currentSeries.variantGroups.flatMap((group) => {
      const points = group.members
        .map((member) => {
          const index = currentSeries.ids.indexOf(member.id);
          return index < 0 ? null : pointPosition(currentPlot, index);
        })
        .filter((position): position is { left: number; top: number } => position !== null);
      return points.slice(1).map((point, index) => ({
        x1: points[index]!.left,
        y1: points[index]!.top,
        x2: point.left,
        y2: point.top,
        representativeId: group.representativeId,
      }));
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
        .filter((position): position is { left: number; top: number } => position !== null);
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
    const discountDots = currentSeries.discounts
      .filter((discount) => discount.pointId === id)
      .flatMap((discount) => {
        const pre = plotPosition(currentPlot.valToPos(discount.preX, "x"), currentPlot.valToPos(discount.y, "y"));
        const effective = plotPosition(currentPlot.valToPos(discount.effectiveX, "x"), currentPlot.valToPos(discount.y, "y"));
        const color = groupColor(discount.groupKey, dark);
        return pre && effective ? [{ ...pre, color }, { ...effective, color }] : [];
      });
    return {
      point,
      pointColor: groupColor(currentSeries.groupKeys[index] ?? modelGroupKey(currentSeries.labels[index] ?? id, id), dark),
      familyDots,
      connectors,
      discountDots,
    };
  });

  return (
    <div
      class="relative w-full"
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
        aria-hidden="true"
        data-testid="chart-decorations"
      >
        <Show when={hoveredPosition()}>
          {(position) => <circle cx={position().left} cy={position().top} r="8" fill="none" stroke="currentColor" stroke-width="2" data-testid="hovered-dot" />}
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
              onMouseEnter={() => setModelLabelHover(segment.representativeId)}
              onMouseLeave={() => {
                setLabelHover(null);
                props.onHover?.(null);
              }}
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
              <For each={focused().discountDots}>
                {(dot) => (
                  <circle
                    cx={dot.left}
                    cy={dot.top}
                    r={DISCOUNT_DOT_SIZE / 2}
                    fill={dot.color}
                    stroke={dot.color}
                    data-testid="focused-discount-dot"
                  />
                )}
              </For>
              <For each={focused().familyDots}>
                {(dot) => (
                  <circle
                    cx={dot.left}
                    cy={dot.top}
                    r={DOT_SIZE / 2}
                    fill={dot.color}
                    stroke={dot.color}
                    data-testid="focused-model-dot"
                    data-model-id={dot.id}
                  />
                )}
              </For>
            </>
          )}
        </Show>
        <For each={pointDecorations()}>
          {(point) => (
            <g
              transform={`translate(${point.left - 9} ${point.top - 27})`}
              fill="none"
              stroke={point.color}
              opacity={isFocusedFamilyId(point.id) ? 1 : 0.2}
            >
              <Crown width={18} height={18} aria-hidden="true" data-testid="pareto-crown" />
            </g>
          )}
        </For>
        <For each={discountDecorations()}>
          {(discount) => {
            return (
              <g
                fill="none"
                stroke={discount.color}
                stroke-width="1"
                stroke-dasharray="1 4"
                stroke-linecap="round"
                stroke-linejoin="round"
                data-testid="discount-line"
                data-discount-id={discount.id}
                data-discount-percentage={discount.percentage}
                data-discount-provider-role={discount.providerRole ?? "plotted"}
                opacity={hoveredLabelId() === null || hoveredLabelId() === discount.pointId ? 1 : 0.2}
              >
                <line
                  x1={discount.preLeft}
                  y1={discount.top}
                  x2={discount.effectiveLeft}
                  y2={discount.top}
                  stroke-width="1"
                  stroke-dasharray="1 4"
                />
              </g>
            );
          }}
        </For>
      </svg>
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
              // Start the leader beyond the dot edge, rather than at its
              // center. Layout already keeps labels clear of all obstacles;
              // this small gap prevents the line from visually touching the
              // dot while retaining leaders for short connections.
              const directionLeft = distance > 0 ? deltaLeft / distance : 1;
              const directionTop = distance > 0 ? deltaTop / distance : 0;
              const startLeft = label.anchorLeft + directionLeft * (LABEL_DOT_RADIUS + LEADER_LINE_GAP);
              const startTop = label.anchorTop + directionTop * (LABEL_DOT_RADIUS + LEADER_LINE_GAP);
              return (
                <line
                  x1={startLeft}
                  y1={startTop}
                  x2={endLeft}
                  y2={endTop}
                  stroke={themeStyles().leaderColor}
                  stroke-opacity={hoveredLabelId() === null || hoveredLabelId() === label.id ? "0.5" : "0.1"}
                  stroke-width="0.75"
                  data-testid="model-label-leader"
                />
              );
            }}
          </For>
        </svg>
        <For each={labelPositions()}>
          {(label) => (
            <span
              class="pointer-events-auto absolute z-1 cursor-default whitespace-nowrap rounded bg-base-100/80 px-1 text-left text-xs leading-5 shadow-sm"
              style={{
                left: `${label.left}px`,
                top: `${label.top}px`,
                width: `${label.width}px`,
                height: `${label.height}px`,
                color: label.color,
                // Labels participate in family emphasis but never expose a
                // tooltip cursor or an additional hover circle.
                opacity: hoveredLabelId() === null || hoveredLabelId() === label.id ? 1 : 0.2,
                "font-size": `${MODEL_LABEL_FONT_SIZE}px`,
                "line-height": `${MODEL_LABEL_LINE_HEIGHT}px`,
              }}
              data-testid="model-label"
              data-model-id={label.id}
              tabIndex="0"
              onMouseEnter={() => setModelLabelHover(label.id)}
              onMouseLeave={() => {
                setLabelHover(null);
                props.onHover?.(null);
              }}
              onFocus={() => setModelLabelHover(label.id)}
              onBlur={() => {
                setLabelHover(null);
                props.onHover?.(null);
              }}
            >
              {label.label}
            </span>
          )}
        </For>
      </Show>
    </div>
  );
}
