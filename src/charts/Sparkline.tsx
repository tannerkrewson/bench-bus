import { onCleanup, onMount, createSignal } from "solid-js";
import uPlot, { type Options } from "uplot";
import "uplot/dist/uPlot.min.css";

export interface SparklineProps {
  /** Y values plotted against their 0-based index. */
  values: number[];
  width?: number;
  height?: number;
}

/**
 * Minimal uPlot wrapper proving the chart dependency is wired into the app.
 * The real reusable chart system is built in a dedicated later issue.
 */
export default function Sparkline(props: SparklineProps) {
  let container: HTMLDivElement | undefined;
  const [plot, setPlot] = createSignal<uPlot | null>(null);

  onMount(() => {
    if (!container) return;
    const width = props.width ?? container.clientWidth;
    const height = props.height ?? 120;

    const opts: Options = {
      width,
      height,
      cursor: { show: false },
      legend: { show: false },
      axes: [{ show: false }, { show: false }],
      series: [{}, { stroke: "#10b981", width: 2, fill: "rgba(16, 185, 129, 0.15)" }],
    };

    const data = [
      Float64Array.from(props.values.map((_, i) => i)),
      Float64Array.from(props.values),
    ];

    setPlot(new uPlot(opts, data, container));

    const resize = () => {
      if (!container) return;
      plot()?.setSize({ width: container.clientWidth, height });
    };
    window.addEventListener("resize", resize);
    onCleanup(() => {
      window.removeEventListener("resize", resize);
      plot()?.destroy();
    });
  });

  return <div ref={container} class="w-full" aria-hidden="true" />;
}
