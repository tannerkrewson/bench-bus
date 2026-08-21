import { For, Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import uPlot, { type Options } from "uplot";
import "uplot/dist/uPlot.min.css";
import { MODEL_BRANDS, inferModelBrand, modelBrandColor } from "./brand";
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

type CurrentSeries = ReturnType<typeof toPlotSeries> & {
  brands: ModelBrand[];
  labels: string[];
  frontierIds: string[];
};

interface LabelPosition {
  id: string;
  label: string;
  left: number;
  top: number;
  color: string;
}

/**
 * Reusable uPlot scatter wrapper. uPlot remains responsible for axes and
 * interaction, while brand series, the frontier, and labels are derived from
 * the same point set so all three stay aligned after filtering or pricing
 * changes.
 */
export default function BenchmarkScatterChart(props: BenchmarkScatterChartProps) {
  let container: HTMLDivElement | undefined;
  let plot: uPlot | null = null;
  let hoveredIndex: number | null = null;
  let currentSeries: CurrentSeries = {
    x: [],
    y: [],
    ids: [],
    droppedIds: [],
    brands: [],
    labels: [],
    frontierIds: [],
  };
  const [labelPositions, setLabelPositions] = createSignal<LabelPosition[]>([]);

  const refreshSeries = () => {
    const points = props.points();
    const series = toPlotSeries(points, props.scale());
    const pointById = new Map(points.map((point) => [point.id, point]));
    const plottedPoints = series.ids
      .map((id) => pointById.get(id))
      .filter((point): point is PlottablePoint => point !== undefined);
    const frontierIds = paretoFrontier(plottedPoints).map((point) => point.id);

    currentSeries = {
      ...series,
      brands: series.ids.map((id) => {
        const point = pointById.get(id);
        return point?.brand ?? inferModelBrand(point?.label, id);
      }),
      labels: series.ids.map((id) => pointById.get(id)?.label ?? id),
      frontierIds,
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
    const brandRows = MODEL_BRANDS.map((brand) => pointDataForBrand(brand));
    // uPlot accepts null-gapped plain arrays at runtime; its typings only
    // cover TypedArrays, so the sparse rows are cast at this boundary.
    return [
      Float64Array.from(currentSeries.x),
      ...brandRows,
      toHighlightY(currentSeries, props.selectedId()),
    ] as unknown as uPlot.AlignedData;
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
    if (!plot || !(props.showLabels?.() ?? true)) {
      setLabelPositions([]);
      return;
    }
    const currentPlot = plot;
    const positions = currentSeries.ids.flatMap((id, index) => {
      const x = currentSeries.x[index];
      const y = currentSeries.y[index];
      if (x === undefined || y === undefined) return [];
      const brand = currentSeries.brands[index] ?? "other";
      return [
        {
          id,
          label: currentSeries.labels[index] ?? id,
          left: uPlotPosition(currentPlot, x, "x") + 8,
          top: uPlotPosition(currentPlot, y, "y") - 8,
          color: modelBrandColor(brand, themeStyles().dark),
        },
      ];
    });
    setLabelPositions(positions);
  };

  const scheduleLabelPositions = () => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(updateLabelPositions);
    } else {
      updateLabelPositions();
    }
  };

  const drawFrontier = (u: uPlot) => {
    if (currentSeries.frontierIds.length < 2) return;
    const points = currentSeries.frontierIds
      .map((id) => {
        const index = currentSeries.ids.indexOf(id);
        return index < 0 ? null : { x: currentSeries.x[index]!, y: currentSeries.y[index]! };
      })
      .filter((point): point is { x: number; y: number } => point !== null)
      .sort((a, b) => a.x - b.x);
    if (points.length < 2) return;

    const ctx = u.ctx;
    const { frontierColor } = themeStyles();
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = frontierColor;
    points.forEach((point, index) => {
      const left = u.valToPos(point.x, "x", true);
      const top = u.valToPos(point.y, "y", true);
      if (index === 0) ctx.moveTo(left, top);
      else ctx.lineTo(left, top);
    });
    ctx.stroke();
    ctx.restore();
  };

  const buildOptions = (): Options => {
    const scale = props.scale();
    const styles = themeStyles();
    return {
      width: container?.clientWidth ?? 0,
      height: props.height ?? 420,
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
          if (seriesIndex > MODEL_BRANDS.length) return null;
          return nearestIndexForBrand(u, MODEL_BRANDS[seriesIndex - 1]!);
        },
      },
      series: [
        {},
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
        // Draw after the points so the enabled-by-default frontier remains
        // visible even when the first series has no path of its own.
        draw: [drawFrontier],
        ready: [scheduleLabelPositions],
        setCursor: [
          (u) => {
            const index = hoveredPointIndex(u);
            hoveredIndex = index;
            const id = index === null ? null : (currentSeries.ids[index] ?? null);
            if (id === null) props.onHover?.(null);
            else props.onHover?.(id, { left: u.cursor.left ?? 0, top: u.cursor.top ?? 0 });
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
      plot.setSize({ width: container.clientWidth, height: props.height ?? 420 });
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
        plot?.setData(dataFor());
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
        <For each={labelPositions()}>
          {(label) => (
            <span
              class="pointer-events-none absolute z-1 max-w-40 -translate-y-1/2 overflow-hidden rounded bg-base-100/70 px-1 text-left text-[10px] leading-tight shadow-sm"
              style={{ left: `${label.left}px`, top: `${label.top}px`, color: label.color }}
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

function uPlotPosition(plot: uPlot, value: number, scale: "x" | "y"): number {
  return plot.valToPos(value, scale, true);
}
