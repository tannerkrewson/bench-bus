import { createEffect, on, onCleanup, onMount } from "solid-js";
import uPlot, { type Options } from "uplot";
import "uplot/dist/uPlot.min.css";
import { toHighlightY, toPlotSeries } from "./plotData";
import type { PlottablePoint, XScale } from "./types";

export interface BenchmarkScatterChartProps {
  /** Points currently passing filters, in stable order. */
  points: () => readonly PlottablePoint[];
  scale: () => XScale;
  /** Single emphasized selection, or null. */
  selectedId: () => string | null;
  xAxisLabel: () => string;
  yAxisLabel: () => string;
  height?: number;
  /** Hover/nearest-point changes (null on leave); pos is cursor px within the chart box. */
  onHover?: (id: string | null, pos?: { left: number; top: number }) => void;
  /** Click/Enter activation on a point. */
  onActivate?: (id: string) => void;
}

const POINT_FILL = "#2563eb";
const SELECTED_FILL = "#dc2626";

/**
 * Reusable uPlot scatter wrapper. The uPlot instance is created once per
 * axis-scale mode (uPlot cannot switch distr in place); every data,
 * selection, or label change is applied with setData/setOptions so normal
 * interaction never reconstructs the plot.
 */
export default function BenchmarkScatterChart(props: BenchmarkScatterChartProps) {
  let container: HTMLDivElement | undefined;
  let plot: uPlot | null = null;
  // Series snapshot shared with uPlot hooks so cursor events do not rebuild
  // arrays on every mousemove; refreshed whenever data is (re)loaded.
  let currentSeries: ReturnType<typeof toPlotSeries> = { x: [], y: [], ids: [], droppedIds: [] };

  const refreshSeries = () => {
    currentSeries = toPlotSeries(props.points(), props.scale());
    return currentSeries;
  };

  const buildOptions = (): Options => {
    const scale = props.scale();
    const styles = getComputedStyle(container ?? document.documentElement);
    const textColor =
      styles.getPropertyValue("--color-base-content").trim() || styles.color || "#111827";
    const gridColor = styles.getPropertyValue("--color-base-300").trim() || "rgba(128,128,128,.25)";
    return {
      width: container?.clientWidth ?? 0,
      height: props.height ?? 420,
      // time:false is essential — uPlot defaults the x axis to epoch-time
      // formatting, which collapses USD costs into one pixel cluster.
      scales: { x: { time: false, distr: scale === "log" ? 3 : 1, log: 10 } },
      axes: [
        { label: props.xAxisLabel(), stroke: textColor, grid: { stroke: gridColor } },
        { label: props.yAxisLabel(), stroke: textColor, grid: { stroke: gridColor } },
      ],
      legend: { show: false },
      cursor: { drag: { x: false, y: false } },
      series: [
        {},
        {
          label: "Models",
          stroke: "rgba(0,0,0,0)",
          width: 0,
          points: { show: true, size: 5, stroke: POINT_FILL, fill: POINT_FILL },
        },
        {
          label: "Selected",
          stroke: "rgba(0,0,0,0)",
          width: 0,
          points: { show: true, size: 9, stroke: SELECTED_FILL, fill: SELECTED_FILL },
        },
      ],
      hooks: {
        // uPlot reports the nearest data index under the cursor.
        setCursor: [
          (u) => {
            const idx = u.cursor.idx ?? null;
            const id = idx === null ? null : (currentSeries.ids[idx] ?? null);
            if (id === null) {
              props.onHover?.(null);
            } else {
              props.onHover?.(id, { left: u.cursor.left ?? 0, top: u.cursor.top ?? 0 });
            }
          },
        ],
      },
    };
  };

  const dataFor = (): uPlot.AlignedData => {
    const s = refreshSeries();
    // uPlot accepts null-gapped plain arrays for sparse series at runtime;
    // its typings only cover TypedArrays, so the highlight row is cast.
    return [Float64Array.from(s.x), Float64Array.from(s.y), toHighlightY(s, props.selectedId())] as unknown as uPlot.AlignedData;
  };

  const createPlot = () => {
    if (!container) return;
    plot?.destroy();
    plot = new uPlot(buildOptions(), dataFor(), container);
  };

  onMount(() => {
    createPlot();

    const resize = () => {
      if (!container || !plot) return;
      plot.setSize({ width: container.clientWidth, height: props.height ?? 420 });
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
      if (!plot) return;
      const idx = plot.cursor.idx ?? null;
      if (idx === null) return;
      const id = currentSeries.ids[idx];
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

  // Everything else is an in-place update.
  createEffect(
    on(
      () => [props.points(), props.selectedId()] as const,
      () => {
        plot?.setData(dataFor());
      },
      { defer: true },
    ),
  );

  createEffect(on(() => [props.xAxisLabel(), props.yAxisLabel()] as const, createPlot, { defer: true }));

  return (
    <div
      ref={container}
      class="w-full"
      role="img"
      aria-label={`Scatter chart of ${props.yAxisLabel()} versus ${props.xAxisLabel()}`}
      data-testid="benchmark-scatter"
    />
  );
}
