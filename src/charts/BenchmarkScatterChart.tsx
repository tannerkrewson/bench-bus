import { For, Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import uPlot, { type Options } from "uplot";
import "uplot/dist/uPlot.min.css";
import { effortGroupColor, inferModelBrand } from "./brand";
import {
  groupModelVariants,
  layoutModelLabels,
  type ModelVariantGroup,
  type ModelVariantMember,
} from "./labelLayout";
import { explicitDiscountForPoint, paretoFrontier, toHighlightY, toPlotSeries } from "./plotData";
import { formatDollarTick, formatPercentTick } from "../utils/format";
import type { PlottablePoint, XScale } from "./types";

export interface BenchmarkScatterChartProps {
  /** Points currently passing filters, in stable order. */
  points: () => readonly PlottablePoint[];
  scale: () => XScale;
  /** Single emphasized selection, or null. */
  selectedId: () => string | null;
  xAxisLabel: () => string;
  yAxisLabel: () => string;
  /** Model labels are enabled by default and controlled by the section toggle. */
  showLabels?: () => boolean;
  height?: number;
  /** Hover changes only when the pointer is within the hit radius of a dot. */
  onHover?: (id: string | null, pos?: { left: number; top: number }) => void;
  /** Click/Enter activation on a point. */
  onActivate?: (id: string) => void;
}

const SELECTED_FILL = "#dc2626";
const DOT_SIZE = 9;
const SELECTED_SIZE = 12;
const DISCOUNT_DOT_SIZE = 7;
const DOT_HIT_RADIUS = 14;
const LEADER_LINE_THRESHOLD = 28;

type DiscountAnnotation = {
  id: string;
  preX: number;
  effectiveX: number;
  y: number;
  percentage: number;
  providerName?: string;
};

type CurrentSeries = ReturnType<typeof toPlotSeries> & {
  labels: string[];
  effortGroups: (string | null)[];
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
  let currentSeries: CurrentSeries = {
    x: [],
    y: [],
    ids: [],
    droppedIds: [],
    labels: [],
    effortGroups: [],
    frontierIds: [],
    variantGroups: [],
    discounts: [],
  };
  const [labelPositions, setLabelPositions] = createSignal<ReturnType<typeof layoutModelLabels>>([]);
  const [hoveredPosition, setHoveredPosition] = createSignal<{ left: number; top: number } | null>(null);
  const [pointDecorations, setPointDecorations] = createSignal<{ id: string; left: number; top: number; color: string }[]>([]);

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
    const discounts: DiscountAnnotation[] = orderedPoints.flatMap((point) => {
      const discount = explicitDiscountForPoint(point);
      if (!discount) return [];
      return [{
        id: point.id,
        preX: discount.preDiscountX,
        effectiveX: point.x,
        y: point.y,
        percentage: discount.percentage,
        providerName: discount.providerName,
      }];
    });
    currentSeries = {
      x: orderedIds.map((id) => series.x[indexById.get(id)!]!),
      y: orderedIds.map((id) => series.y[indexById.get(id)!]!),
      ids: orderedIds,
      droppedIds: series.droppedIds,
      labels: orderedIds.map((id) => pointById.get(id)?.label ?? id),
      effortGroups: orderedIds.map((id) => groupById.get(id) ?? null),
      frontierIds,
      variantGroups,
      discounts,
    };
    return currentSeries;
  };

  const themeStyles = () => {
    const styles = getComputedStyle(container ?? document.documentElement);
    const dark = document.documentElement.dataset.theme === "dark";
    return {
      dark,
      textColor:
        styles.getPropertyValue("--color-base-content").trim() || styles.color || "#111827",
      gridColor:
        styles.getPropertyValue("--color-base-300").trim() || "rgba(128,128,128,.25)",
      frontierColor:
        styles.getPropertyValue("--color-primary").trim() || (dark ? "#a78bfa" : "#4f46e5"),
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
      ...currentSeries.frontierIds.map((id) => pointById.get(id)?.y ?? null),
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
    const groupKeys = [...new Set(currentSeries.effortGroups.filter((group): group is string => group !== null))];
    const pointRows = groupKeys.map((key) => {
      const row = new Array<number | null>(dataX.length).fill(null);
      currentSeries.effortGroups.forEach((group, index) => {
        if (group === key) row[actualOffset + index] = currentSeries.y[index]!;
      });
      return row;
    });
    const ungroupedRow = new Array<number | null>(dataX.length).fill(null);
    currentSeries.effortGroups.forEach((group, index) => {
      if (group === null) ungroupedRow[actualOffset + index] = currentSeries.y[index]!;
    });
    const discountDots = currentSeries.discounts.map((discount, index) => {
      const row = new Array<number | null>(dataX.length).fill(null);
      row[discountOffset + index] = discount.y;
      return row;
    });
    const selectedRow = [
      ...new Array<number | null>(actualOffset).fill(null),
      ...toHighlightY(currentSeries, props.selectedId()),
    ];
    // uPlot accepts null-gapped plain arrays at runtime; its typings only
    // cover TypedArrays, so the sparse rows are cast at this boundary.
    return [Float64Array.from(dataX), frontierY, ...connectorRows, ...discountRows, ...pointRows, ungroupedRow, ...discountDots, selectedRow] as unknown as uPlot.AlignedData;
  };

  const hoveredPointIndex = (u: uPlot): number | null => {
    const cursorLeft = u.cursor.left ?? -Infinity;
    const cursorTop = u.cursor.top ?? -Infinity;
    let nearest: number | null = null;
    let nearestDistance = Infinity;
    for (let index = 0; index < currentSeries.ids.length; index += 1) {
      const x = currentSeries.x[index];
      const y = currentSeries.y[index];
      if (x === undefined || y === undefined) continue;
      const distance = Math.hypot(u.valToPos(x, "x") - cursorLeft, u.valToPos(y, "y") - cursorTop);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    }
    return nearestDistance <= DOT_HIT_RADIUS ? nearest : null;
  };

  const updateLabelPositions = () => {
    if (!plot || !container?.parentElement) {
      setLabelPositions([]);
      setPointDecorations([]);
      return;
    }
    const currentPlot = plot;
    const over = container.querySelector<HTMLElement>(".u-over");
    if (!over) {
      setLabelPositions([]);
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
      const group = currentSeries.effortGroups[index];
      return [{
        id,
        left: overRect.left - rootRect.left + currentPlot.valToPos(x, "x"),
        top: overRect.top - rootRect.top + currentPlot.valToPos(y, "y"),
        color: group ? effortGroupColor(group, dark) : (dark ? "#cbd5e1" : "#475569"),
      }];
    });
    setPointDecorations(decorations);
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
          color: currentSeries.effortGroups[index]
            ? effortGroupColor(currentSeries.effortGroups[index]!, dark)
            : (dark ? "#cbd5e1" : "#475569"),
          priority: currentSeries.frontierIds.includes(id) ? 1 : 0,
        },
      ];
    });
    setLabelPositions(props.showLabels?.() ?? true ? layoutModelLabels(anchors, bounds) : []);
  };

  const scheduleLabelPositions = () => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(updateLabelPositions);
    } else {
      updateLabelPositions();
    }
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

  const pointPosition = (u: uPlot, index: number) => {
    const x = currentSeries.x[index];
    const y = currentSeries.y[index];
    const over = container?.querySelector<HTMLElement>(".u-over");
    const parent = container?.parentElement;
    if (x === undefined || y === undefined || !over || !parent) return undefined;
    const parentRect = parent.getBoundingClientRect();
    const overRect = over.getBoundingClientRect();
    return {
      left: overRect.left - parentRect.left + u.valToPos(x, "x"),
      top: overRect.top - parentRect.top + u.valToPos(y, "y"),
    };
  };

  const buildOptions = (): Options => {
    const scale = props.scale();
    const styles = themeStyles();
    refreshSeries();
    const pathLength = currentSeries.frontierIds.length + currentSeries.variantGroups.reduce(
      (total, group) => total + group.members.length,
      0,
    ) + currentSeries.discounts.length * 2;
    const actualOffset = pathLength + currentSeries.discounts.length;
    plotStructureKey = `${currentSeries.discounts.length}|${currentSeries.variantGroups
      .map((group) => `${group.key}:${group.members.length}`)
      .join("|")}`;
    return {
      width: container?.clientWidth ?? 0,
      height: props.height ?? (typeof window !== "undefined" && window.innerWidth < 640 ? 500 : 620),
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
        { label: props.xAxisLabel(), stroke: styles.textColor, values: (_u, splits) => splits.map(formatDollarTick), grid: { stroke: styles.gridColor } },
        { label: props.yAxisLabel(), stroke: styles.textColor, values: (_u, splits) => splits.map((value) => /score/i.test(props.yAxisLabel()) ? formatPercentTick(value) : String(value)), grid: { stroke: styles.gridColor } },
      ],
      legend: { show: false },
      cursor: {
        drag: { x: false, y: false },
        // uPlot's default is nearest-in-X, which is not a dot hit test.
        dataIdx: (u, seriesIndex) => {
          if (seriesIndex === 0) return u.cursor.idx ?? null;
          const index = hoveredPointIndex(u);
          return index === null ? null : actualOffset + index;
        },
      },
      series: [
        {},
        {
          label: "Pareto frontier",
          stroke: styles.frontierColor,
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
          stroke: "#64748b",
          width: 1.5,
          dash: [4, 3],
          points: { show: false },
        })),
        ...[...new Set(currentSeries.effortGroups.filter((group): group is string => group !== null))].map((group) => {
          const color = group ? effortGroupColor(group, styles.dark) : (styles.dark ? "#cbd5e1" : "#475569");
          return {
            label: group ? `${group} effort group` : "Ungrouped models",
            stroke: color,
            width: 0,
            points: { show: true, size: DOT_SIZE, width: 1.5, stroke: color, fill: color },
          };
        }),
        ...currentSeries.discounts.map((discount) => ({
          label: `${discount.percentage}% discount before price`,
          stroke: "#64748b",
          width: 0,
          points: { show: true, size: DISCOUNT_DOT_SIZE, width: 1.5, stroke: "#64748b", fill: "#64748b" },
        })),
        {
          label: "Selected",
          stroke: "rgba(0,0,0,0)",
          width: 0,
          points: { show: true, size: SELECTED_SIZE, width: 2, stroke: SELECTED_FILL, fill: SELECTED_FILL },
        },
      ],
      hooks: {
        ready: [scheduleLabelPositions],
        setCursor: [
          (u) => {
            const index = hoveredPointIndex(u);
            hoveredIndex = index;
            const id = index === null ? null : (currentSeries.ids[index] ?? null);
            if (id === null || index === null) {
              setHoveredPosition(null);
              props.onHover?.(null);
            } else {
              const pointer = cursorPosition(u);
              const dot = pointPosition(u, index);
              setHoveredPosition(dot ? {
                left: dot.left - (container?.parentElement?.getBoundingClientRect().left ?? 0),
                top: dot.top - (container?.parentElement?.getBoundingClientRect().top ?? 0),
              } : null);
              // Keep guides centered on the dot while the tooltip remains at the pointer.
              const snappedLeft = u.valToPos(currentSeries.x[index]!, "x");
              const snappedTop = u.valToPos(currentSeries.y[index]!, "y");
              if (Math.abs((u.cursor.left ?? snappedLeft) - snappedLeft) > 0.5 || Math.abs((u.cursor.top ?? snappedTop) - snappedTop) > 0.5) {
                u.cursor.left = snappedLeft;
                u.cursor.top = snappedTop;
                u.redraw();
              }
              props.onHover?.(id, pointer ?? dot);
            }
          },
        ],
      },
    };
  };

  const chartHeight = () => props.height ?? (typeof window !== "undefined" && window.innerWidth < 640 ? 500 : 620);

  const createPlot = () => {
    if (!container) return;
    const scrollY = typeof window !== "undefined" ? window.scrollY : 0;
    plot?.destroy();
    plot = new uPlot(buildOptions(), dataFor(), container);
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

    const click = () => {
      if (!plot || hoveredIndex === null) return;
      const id = currentSeries.ids[hoveredIndex];
      if (id !== undefined) props.onActivate?.(id);
    };
    container?.addEventListener("click", click);
    onCleanup(() => container?.removeEventListener("click", click));

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

  createEffect(
    on(
      () => [props.points(), props.selectedId()] as const,
      () => {
        const data = dataFor();
        const nextStructureKey = `${currentSeries.discounts.length}|${currentSeries.variantGroups
          .map((group) => `${group.key}:${group.members.length}`)
          .join("|")}`;
        if (!plot || nextStructureKey !== plotStructureKey) createPlot();
        else plot.setData(data);
        scheduleLabelPositions();
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      () => props.showLabels?.() ?? true,
      () => scheduleLabelPositions(),
      { defer: true },
    ),
  );

  createEffect(on(() => [props.xAxisLabel(), props.yAxisLabel()] as const, createPlot, { defer: true }));

  return (
    <div
      class="relative w-full"
      role="img"
      aria-label={`Scatter chart of ${props.yAxisLabel()} versus ${props.xAxisLabel()}`}
      data-testid="benchmark-scatter"
    >
      <div ref={container} class="w-full" data-testid="benchmark-scatter-plot" />
      <svg class="pointer-events-none absolute inset-0 z-1 overflow-visible" aria-label="Pareto frontier markers" data-testid="chart-decorations">
        <Show when={hoveredPosition()}>
          {(position) => <circle cx={position().left} cy={position().top} r="6" fill="none" stroke="currentColor" stroke-width="2" data-testid="hovered-dot" />}
        </Show>
        <For each={pointDecorations()}>
          {(point) => (
            <text x={point.left} y={point.top - 10} fill={point.color} text-anchor="middle" font-size="13" aria-label={`${point.id} is on the Pareto frontier`} data-testid="pareto-crown">♛</text>
          )}
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
              const distance = Math.hypot(label.anchorLeft - endLeft, label.anchorTop - endTop);
              return (
                <Show when={distance >= LEADER_LINE_THRESHOLD}>
                  <line
                    x1={label.anchorLeft}
                    y1={label.anchorTop}
                    x2={endLeft}
                    y2={endTop}
                    stroke={label.color}
                    stroke-opacity="0.38"
                    stroke-width="1"
                    data-testid="model-label-leader"
                  />
                </Show>
              );
            }}
          </For>
        </svg>
        <For each={labelPositions()}>
          {(label) => (
            <span
              class="pointer-events-none absolute z-1 overflow-hidden whitespace-nowrap rounded bg-base-100/90 px-1 text-ellipsis text-left text-xs leading-5 shadow-sm"
              title={label.label}
              style={{
                left: `${label.left}px`,
                top: `${label.top}px`,
                width: `${label.width}px`,
                height: `${label.height}px`,
                color: label.color,
              }}
              data-testid="model-label"
              data-model-id={label.id}
            >
              {label.label}
            </span>
          )}
        </For>
      </Show>
    </div>
  );
}
