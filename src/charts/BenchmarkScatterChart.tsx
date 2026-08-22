import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { Crown } from "lucide-solid";
import uPlot, { type Options } from "uplot";
import { isDarkTheme } from "../components/ThemeToggle";
import "uplot/dist/uPlot.min.css";
import { effortGroupColor, inferModelBrand, modelBrandColor } from "./brand";
import {
  groupModelVariants,
  layoutModelLabels,
  type ModelVariantGroup,
  type ModelVariantMember,
} from "./labelLayout";
import {
  largestExplicitDiscountForPoint,
  paretoFrontier,
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
const DOT_HIT_RADIUS = 14;
const LABEL_DOT_RADIUS = 8;
const LEADER_LINE_GAP = 3;

type DiscountAnnotation = {
  id: string;
  pointId: string;
  preX: number;
  effectiveX: number;
  y: number;
  percentage: number;
  providerName?: string;
  providerRole?: "plotted" | "alternative";
};

type DiscountDecoration = {
  id: string;
  pointId: string;
  preLeft: number;
  effectiveLeft: number;
  top: number;
  labelLeft: number;
  percentage: number;
  providerRole?: "plotted" | "alternative";
};

type CurrentSeries = ReturnType<typeof toPlotSeries> & {
  labels: string[];
  effortGroups: (string | null)[];
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
  let currentSeries: CurrentSeries = {
    x: [],
    y: [],
    ids: [],
    droppedIds: [],
    labels: [],
    effortGroups: [],
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
  let hoveredLabelBounds: { left: number; top: number; right: number; bottom: number } | null = null;

  const refreshSeries = () => {
    const points = props.points();
    const series = toPlotSeries(points, props.scale());
    const pointById = new Map(points.map((point) => [point.id, point]));
    const plottedPoints = series.ids
      .map((id) => pointById.get(id))
      .filter((point): point is PlottablePoint => point !== undefined);
    const frontierIds = paretoFrontier(plottedPoints).map((point) => point.id);
    const members: ModelVariantMember[] = series.ids.flatMap((id) => {
      const point = pointById.get(id);
      if (!point) return [];
      return [{
        id,
        label: point.label,
        brand: point.brand ?? inferModelBrand(point.label, id),
        effortGroup: point.effortGroup,
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
          if (!discount) return [];
          return [{
            id: point.id,
            pointId: point.id,
            preX: discount.preDiscountX,
            effectiveX: discount.effectiveX ?? point.x,
            y: point.y,
            percentage: discount.percentage,
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
      labels: orderedIds.map((id) => pointById.get(id)?.label ?? id),
      effortGroups: orderedIds.map((id) => groupById.get(id) ?? null),
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
      discountColor: dark ? "#cbd5e1" : "#475569",
    };
  };

  const dataFor = (): uPlot.AlignedData => {
    refreshSeries();
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
      ...(props.showFrontier?.() ?? true)
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
    const dark = themeStyles().dark;
    const pointColorKeys = [...new Set(
      currentSeries.brands.map((brand) => modelBrandColor(brand, dark)),
    )];
    const pointRows = pointColorKeys.map((color) => {
      const row = new Array<number | null>(dataX.length).fill(null);
      currentSeries.brands.forEach((brand, index) => {
        if (modelBrandColor(brand, dark) === color) row[actualOffset + index] = currentSeries.y[index]!;
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
    return [Float64Array.from(dataX), frontierY, ...connectorRows, ...discountRows, ...pointRows, ...discountDots] as unknown as uPlot.AlignedData;
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
    return nearest && nearest.distance <= DOT_HIT_RADIUS ? nearest : null;
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
    const dark = themeStyles().dark;
    const representativeById = new Map(
      currentSeries.variantGroups.flatMap((group) =>
        group.members.map((member) => [member.id, group.representativeId] as const),
      ),
    );
    const decorations = currentSeries.ids.flatMap((id, index) => {
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
    setPointDecorations(decorations);
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
        labelLeft: (preLeft + effectiveLeft) / 2,
        percentage: discount.percentage,
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
          color: modelBrandColor(currentSeries.brands[index] ?? "other", dark),
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
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(updateLabelPositions);
    } else {
      updateLabelPositions();
    }
  };

  const pointerPositionFromEvent = (event: { clientX: number; clientY: number }) => {
    const over = container?.querySelector<HTMLElement>(".u-over");
    const parent = container?.parentElement;
    if (!over || !parent) return undefined;
    const parentRect = parent.getBoundingClientRect();
    return { left: event.clientX - parentRect.left, top: event.clientY - parentRect.top };
  };

  const setLabelHover = (id: string | null) => {
    setHoveredLabelId(id);
    hoveredLabelBounds = null;
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
    if (u.cursor.left == null || u.cursor.top == null) {
      horizontal.style.width = "0px";
      vertical.style.height = "0px";
      return;
    }
    const left = Math.max(0, u.cursor.left);
    const top = Math.max(0, u.cursor.top);
    horizontal.style.left = "0px";
    horizontal.style.width = `${left}px`;
    vertical.style.left = `${left}px`;
    vertical.style.top = `${top}px`;
    vertical.style.height = `${Math.max(0, over.clientHeight - top)}px`;
  };

  const buildOptions = (): Options => {
    const scale = props.scale();
    const styles = themeStyles();
    refreshSeries();
    const pointBrands = [...new Set(currentSeries.brands)];
    plotStructureKey = `${currentSeries.discounts.length}|${currentSeries.variantGroups
      .map((group) => `${group.key}:${group.members.length}`)
      .join("|")}|${pointBrands.join("|")}`;
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
          values: (_u, splits) => splits.map(formatDollarTick),
          grid: { stroke: styles.gridColor },
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
          values: (_u, splits) => splits.map((value) => /score/i.test(props.yAxisLabel()) ? formatPercentTick(value) : String(value)),
          grid: { stroke: styles.gridColor },
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
        {
          label: "Pareto frontier",
          stroke: props.showFrontier?.() ?? true ? styles.frontierColor : "rgba(0,0,0,0)",
          width: 2,
          dash: [5, 4],
          points: { show: false },
        },
        ...currentSeries.variantGroups.map((group) => ({
          label: `${group.baseLabel} effort variants`,
          stroke: effortGroupColor(group.key, styles.dark),
          width: 1.5,
          alpha: 0.62,
          points: { show: false },
        })),
        ...currentSeries.discounts.map((discount) => ({
          label: `${discount.percentage}% discount: ${discount.providerName ?? "provider"}`,
          stroke: styles.discountColor,
          width: 1.5,
          dash: [4, 3],
          points: { show: false },
        })),
        ...pointBrands.map((brand) => {
          const color = modelBrandColor(brand, styles.dark);
          return {
            label: `${brand} models`,
            stroke: color,
            width: 0,
            points: { show: true, size: DOT_SIZE, width: 1.5, stroke: color, fill: color },
          };
        }),
        ...currentSeries.discounts.map((discount) => ({
          label: `${discount.percentage}% discount before price`,
          stroke: styles.discountColor,
          width: 0,
          points: { show: true, size: DISCOUNT_DOT_SIZE, width: 1.5, stroke: styles.discountColor, fill: styles.discountColor },
        })),
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
    const canvas = container?.querySelector<HTMLCanvasElement>("canvas");
    if (canvas) canvas.style.opacity = hoveredLabelId() === null ? "1" : "0.2";
  };

  const createPlot = () => {
    if (!container) return;
    const hoveredId = hoveredIndex === null ? null : currentSeries.ids[hoveredIndex];
    const scrollY = typeof window !== "undefined" ? window.scrollY : 0;
    plot?.destroy();
    plot = new uPlot(buildOptions(), dataFor(), container);
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
    onCleanup(() => window.removeEventListener("bench-bus-theme-change", onThemeChange));

    onCleanup(() => {
      plot?.destroy();
      plot = null;
    });
  });

  // Axis scale changes uPlot's distr, which is construction-time only.
  createEffect(on(() => props.scale(), createPlot, { defer: true }));

  const applyPlotData = () => {
    const hoveredId = hoveredIndex === null ? null : currentSeries.ids[hoveredIndex];
    const data = dataFor();
    hoveredIndex = hoveredId === undefined || hoveredId === null
      ? null
      : currentSeries.ids.indexOf(hoveredId);
    const nextStructureKey = `${currentSeries.discounts.length}|${currentSeries.variantGroups
      .map((group) => `${group.key}:${group.members.length}`)
      .join("|")}|${[...new Set(currentSeries.brands)].join("|")}`;
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
      () => [props.points(), props.showFrontier?.() ?? true, props.showDiscounts?.() ?? true] as const,
      schedulePlotData,
      { defer: true },
    ),
  );

  onCleanup(() => {
    if (plotUpdateFrame !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(plotUpdateFrame);
      plotUpdateFrame = null;
    }
  });

  createEffect(
    on(
      () => props.showLabels?.() ?? true,
      () => scheduleLabelPositions(),
      { defer: true },
    ),
  );

  createEffect(on(() => [props.xAxisLabel(), props.yAxisLabel()] as const, createPlot, { defer: true }));

  createEffect(() => {
    hoveredLabelId();
    applyPlotEmphasis();
  });

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
          color: effortGroupColor(group.key, dark),
        });
      }
    }
    const discountDots = currentSeries.discounts
      .filter((discount) => discount.pointId === id)
      .flatMap((discount) => {
        const pre = plotPosition(currentPlot.valToPos(discount.preX, "x"), currentPlot.valToPos(discount.y, "y"));
        const effective = plotPosition(currentPlot.valToPos(discount.effectiveX, "x"), currentPlot.valToPos(discount.y, "y"));
        return pre && effective ? [pre, effective] : [];
      });
    return {
      point,
      pointColor: modelBrandColor(currentSeries.brands[index] ?? "other", dark),
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
      />
      <svg
        class="pointer-events-none absolute inset-0 z-1 overflow-visible"
        aria-hidden="true"
        data-testid="chart-decorations"
      >
        <Show when={hoveredPosition()}>
          {(position) => <circle cx={position().left} cy={position().top} r="6" fill="none" stroke="currentColor" stroke-width="2" data-testid="hovered-dot" />}
        </Show>
        <Show when={hoveredLabelId()}>
          {(id) => {
            const label = labelPositions().find((candidate) => candidate.id === id());
            return label ? (
              <circle cx={label.anchorLeft} cy={label.anchorTop} r="8" fill="none" stroke={label.color} stroke-width="2" data-testid="label-hover-highlight" />
            ) : null;
          }}
        </Show>
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
                    fill={themeStyles().discountColor}
                    stroke={themeStyles().discountColor}
                    data-testid="focused-discount-dot"
                  />
                )}
              </For>
              <circle
                cx={focused().point.left}
                cy={focused().point.top}
                r={DOT_SIZE / 2}
                fill={focused().pointColor}
                stroke={focused().pointColor}
                data-testid="focused-model-dot"
              />
            </>
          )}
        </Show>
        <Show when={props.showFrontier?.() ?? true}>
          <For each={pointDecorations()}>
            {(point) => (
              <g
                transform={`translate(${point.left - 9} ${point.top - 27})`}
                fill="none"
                stroke={point.color}
                opacity={hoveredLabelId() === null || hoveredLabelId() === point.id ? 1 : 0.2}
              >
                <Crown width={18} height={18} aria-hidden="true" data-testid="pareto-crown" />
              </g>
            )}
          </For>
        </Show>
        <For each={discountDecorations()}>
          {(discount) => {
            const direction = discount.effectiveLeft >= discount.preLeft ? 1 : -1;
            const headStart = discount.effectiveLeft - direction * 7;
            return (
              <g
                fill="none"
                stroke={themeStyles().discountColor}
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                data-testid="discount-arrow"
                data-discount-id={discount.id}
                data-discount-percentage={discount.percentage}
                data-discount-provider-role={discount.providerRole ?? "plotted"}
                opacity={hoveredLabelId() === null || hoveredLabelId() === discount.pointId ? 1 : 0.2}
              >
                <path d={`M ${headStart} ${discount.top - 4} L ${discount.effectiveLeft} ${discount.top} L ${headStart} ${discount.top + 4}`} />
              </g>
            );
          }}
        </For>
      </svg>
      <For each={discountDecorations()}>
        {(discount) => (
          <button
            type="button"
            class="pointer-events-auto absolute z-2 -translate-x-1/2 whitespace-nowrap rounded bg-base-100/90 px-1 text-[11px] font-semibold text-base-content shadow-sm"
            style={{ left: `${discount.labelLeft}px`, top: `${discount.top - 24}px`, opacity: hoveredLabelId() === null || hoveredLabelId() === discount.pointId ? 1 : 0.2 }}
            data-testid="discount-label"
            data-discount-id={discount.id}
            aria-label={`${discount.percentage}% discount; show discount details`}
            onMouseEnter={(event) => {
              setLabelHover(discount.pointId);
              props.onHover?.(discount.pointId, pointerPositionFromEvent(event));
            }}
            onMouseLeave={() => {
              setLabelHover(null);
              props.onHover?.(null);
            }}
            onFocus={() => {
              setLabelHover(discount.pointId);
              props.onHover?.(discount.pointId, { left: discount.labelLeft, top: discount.top });
            }}
            onBlur={() => {
              setLabelHover(null);
              props.onHover?.(null);
            }}
          >
            {discount.percentage}% off
          </button>
        )}
      </For>
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
                  stroke-opacity={hoveredLabelId() === null || hoveredLabelId() === label.id ? "0.72" : "0.15"}
                  stroke-width="1"
                  data-testid="model-label-leader"
                />
              );
            }}
          </For>
        </svg>
        <For each={labelPositions()}>
          {(label) => (
            <span
              class="pointer-events-auto absolute z-1 cursor-help whitespace-nowrap rounded bg-base-100/90 px-1 text-left text-sm leading-[22px] shadow-sm"
              title={label.label}
              style={{
                left: `${label.left}px`,
                top: `${label.top}px`,
                width: `${label.width}px`,
                height: `${label.height}px`,
                color: label.color,
                opacity: hoveredLabelId() === null || hoveredLabelId() === label.id ? 1 : 0.2,
                "font-size": "14px",
                "line-height": "22px",
              }}
              data-testid="model-label"
              data-model-id={label.id}
              tabIndex="0"
              onMouseEnter={(event) => {
                setLabelHover(label.id);
                props.onHover?.(label.id, pointerPositionFromEvent(event));
              }}
              onMouseLeave={() => {
                setLabelHover(null);
                props.onHover?.(null);
              }}
              onFocus={() => {
                setLabelHover(label.id);
                props.onHover?.(label.id, { left: label.anchorLeft, top: label.anchorTop });
              }}
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
