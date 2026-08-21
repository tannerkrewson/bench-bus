import { For, Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import uPlot, { type Options } from "uplot";
import "uplot/dist/uPlot.min.css";
import { MODEL_BRANDS, inferModelBrand, modelBrandColor } from "./brand";
import {
  groupModelVariants,
  layoutModelLabels,
  type ModelVariantGroup,
  type ModelVariantMember,
} from "./labelLayout";
import { paretoFrontier, toHighlightY, toPlotSeries } from "./plotData";
import type { ModelBrand, PlottablePoint, XScale } from "./types";

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
const DOT_HIT_RADIUS = 14;
const LEADER_LINE_THRESHOLD = 28;

type CurrentSeries = ReturnType<typeof toPlotSeries> & {
  brands: ModelBrand[];
  labels: string[];
  frontierIds: string[];
  variantGroups: ModelVariantGroup[];
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
    brands: [],
    labels: [],
    frontierIds: [],
    variantGroups: [],
  };
  const [labelPositions, setLabelPositions] = createSignal<ReturnType<typeof layoutModelLabels>>([]);

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

    currentSeries = {
      x: orderedIds.map((id) => series.x[indexById.get(id)!]!),
      y: orderedIds.map((id) => series.y[indexById.get(id)!]!),
      ids: orderedIds,
      droppedIds: series.droppedIds,
      brands: orderedIds.map((id) => {
        const point = pointById.get(id);
        return point?.brand ?? inferModelBrand(point?.label, id);
      }),
      labels: orderedIds.map((id) => pointById.get(id)?.label ?? id),
      frontierIds,
      variantGroups,
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

  const pointDataForBrand = (brand: ModelBrand): (number | null)[] =>
    currentSeries.y.map((value, index) => (currentSeries.brands[index] === brand ? value : null));

  const dataFor = (): uPlot.AlignedData => {
    refreshSeries();
    const pointById = new Map(
      currentSeries.ids.map((id, index) => [id, { x: currentSeries.x[index]!, y: currentSeries.y[index]! }]),
    );
    const pathIds = [
      ...currentSeries.frontierIds,
      ...currentSeries.variantGroups.flatMap((group) => group.members.map((member) => member.id)),
    ];
    const pathX = pathIds.map((id) => pointById.get(id)?.x ?? 0);
    const pathLength = pathIds.length;
    const actualLength = currentSeries.ids.length;
    const dataX = [...pathX, ...currentSeries.x];
    const frontierY = [
      ...currentSeries.frontierIds.map((id) => pointById.get(id)?.y ?? null),
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
    const brandRows = MODEL_BRANDS.map((brand) => [
      ...new Array<number | null>(pathLength).fill(null),
      ...pointDataForBrand(brand),
    ]);
    const selectedRow = [
      ...new Array<number | null>(pathLength).fill(null),
      ...toHighlightY(currentSeries, props.selectedId()),
    ];
    // uPlot accepts null-gapped plain arrays at runtime; its typings only
    // cover TypedArrays, so the sparse rows are cast at this boundary.
    return [Float64Array.from(dataX), frontierY, ...connectorRows, ...brandRows, selectedRow] as unknown as uPlot.AlignedData;
  };

  const nearestIndexForBrand = (u: uPlot, brand: ModelBrand): number | null => {
    const cursorLeft = u.cursor.left ?? -Infinity;
    const cursorTop = u.cursor.top ?? -Infinity;
    let nearest: number | null = null;
    let nearestDistance = Infinity;

    for (let index = 0; index < currentSeries.ids.length; index += 1) {
      if (currentSeries.brands[index] !== brand) continue;
      const x = currentSeries.x[index];
      const y = currentSeries.y[index];
      if (x === undefined || y === undefined) continue;
      const dx = u.valToPos(x, "x") - cursorLeft;
      const dy = u.valToPos(y, "y") - cursorTop;
      const distance = Math.hypot(dx, dy);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    }

    return nearestDistance <= DOT_HIT_RADIUS ? nearest : null;
  };

  const hoveredPointIndex = (u: uPlot): number | null => {
    for (const brand of MODEL_BRANDS) {
      const index = nearestIndexForBrand(u, brand);
      if (index !== null) return index;
    }
    return null;
  };

  const updateLabelPositions = () => {
    if (!plot || !(props.showLabels?.() ?? true) || !container?.parentElement) {
      setLabelPositions([]);
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
    const anchors = currentSeries.ids.flatMap((id, index) => {
      const representativeId = representativeById.get(id);
      if (representativeId !== undefined && representativeId !== id) return [];
      const x = currentSeries.x[index];
      const y = currentSeries.y[index];
      if (x === undefined || y === undefined) return [];
      const brand = currentSeries.brands[index] ?? "other";
      return [
        {
          id,
          label: currentSeries.labels[index] ?? id,
          anchorLeft: overRect.left - rootRect.left + currentPlot.valToPos(x, "x"),
          anchorTop: overRect.top - rootRect.top + currentPlot.valToPos(y, "y"),
          color: modelBrandColor(brand, dark),
          priority: currentSeries.frontierIds.includes(id) ? 1 : 0,
        },
      ];
    });
    setLabelPositions(layoutModelLabels(anchors, bounds));
  };

  const scheduleLabelPositions = () => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(updateLabelPositions);
    } else {
      updateLabelPositions();
    }
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
    );
    const brandStart = 2 + currentSeries.variantGroups.length;
    plotStructureKey = currentSeries.variantGroups
      .map((group) => `${group.key}:${group.members.length}`)
      .join("|");
    return {
      width: container?.clientWidth ?? 0,
      height: props.height ?? 540,
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
              : undefined,
        },
      },
      axes: [
        { label: props.xAxisLabel(), stroke: styles.textColor, grid: { stroke: styles.gridColor } },
        { label: props.yAxisLabel(), stroke: styles.textColor, grid: { stroke: styles.gridColor } },
      ],
      legend: { show: false },
      cursor: {
        drag: { x: false, y: false },
        // uPlot's default is nearest-in-X, which is not a dot hit test.
        dataIdx: (u, seriesIndex) => {
          if (seriesIndex === 0) return u.cursor.idx ?? null;
          if (seriesIndex < brandStart || seriesIndex >= brandStart + MODEL_BRANDS.length) return null;
          const index = nearestIndexForBrand(u, MODEL_BRANDS[seriesIndex - brandStart]!);
          return index === null ? null : pathLength + index;
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
          stroke: modelBrandColor(group.brand, styles.dark),
          width: 1.5,
          alpha: 0.62,
          points: { show: false },
        })),
        ...MODEL_BRANDS.map((brand) => {
          const color = modelBrandColor(brand, styles.dark);
          return {
            label: brand,
            stroke: color,
            width: 0,
            points: { show: true, size: DOT_SIZE, width: 1.5, stroke: color, fill: color },
          };
        }),
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
            if (id === null || index === null) props.onHover?.(null);
            else props.onHover?.(id, pointPosition(u, index));
          },
        ],
      },
    };
  };

  const createPlot = () => {
    if (!container) return;
    plot?.destroy();
    plot = new uPlot(buildOptions(), dataFor(), container);
    scheduleLabelPositions();
  };

  onMount(() => {
    createPlot();

    const resize = () => {
      if (!container || !plot) return;
      plot.setSize({ width: container.clientWidth, height: props.height ?? 540 });
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
        const nextStructureKey = currentSeries.variantGroups
          .map((group) => `${group.key}:${group.members.length}`)
          .join("|");
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
              class="pointer-events-none absolute z-1 overflow-hidden whitespace-nowrap rounded bg-base-100/80 px-1 text-ellipsis text-left text-[10px] leading-5 shadow-sm"
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
