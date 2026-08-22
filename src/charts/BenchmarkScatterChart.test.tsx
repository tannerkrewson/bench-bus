import { describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import BenchmarkScatterChart, {
  crosshairGuideGeometry,
  filterDollarAxisSplits,
  filterIntegerAxisSplits,
  filterTenPointGridSplits,
  snapToDotPosition,
} from "./BenchmarkScatterChart";
import type { PlottablePoint } from "./types";

describe("BenchmarkScatterChart pure interaction policies", () => {
  it("filters axis and grid splits without changing accepted values", () => {
    expect(filterDollarAxisSplits([0.5, Number.NaN, 1_000])).toEqual([0.5, null, 1_000]);
    expect(filterIntegerAxisSplits([69, 69.5, 70])).toEqual([69, null, 70]);
    expect(filterTenPointGridSplits([60, 65, 70, 70.5])).toEqual([60, null, 70, null]);
  });

  it("draws crosshair guides left and down from the snapped cursor", () => {
    expect(crosshairGuideGeometry(30, 20, 100)).toEqual({
      horizontal: { left: 0, width: 30 },
      vertical: { left: 30, top: 20, height: 80 },
    });
    expect(crosshairGuideGeometry(null, null, 100)).toEqual({
      horizontal: { left: 0, width: 0 },
      vertical: { left: 0, top: 0, height: 0 },
    });
  });

  it("snaps only within the dot hit radius", () => {
    const dot = { left: 100, top: 80 };
    expect(snapToDotPosition({ left: 108, top: 86 }, dot, 10)).toEqual(dot);
    expect(snapToDotPosition({ left: 111, top: 80 }, dot, 10)).toBeNull();
  });
});

function mount(ui: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(ui, container);
  return { container, dispose: () => { dispose(); container.remove(); } };
}

function chartRect(width: number, height: number) {
  return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height } as DOMRect;
}

/** Give the overlay a real plot box; jsdom otherwise reports zero dimensions. */
function mountSizedChart(ui: () => JSX.Element) {
  const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 800,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 320,
  });
  vi.stubGlobal("Path2D", class {
    moveTo() {}
    lineTo() {}
    rect() {}
    arc() {}
    arcTo() {}
    bezierCurveTo() {}
    closePath() {}
  });
  const canvasContext = {
    beginPath: () => {}, clearRect: () => {}, clip: () => {}, fill: () => {}, fillText: () => {},
    lineTo: () => {}, moveTo: () => {}, rect: () => {}, restore: () => {}, rotate: () => {},
    save: () => {}, setLineDash: () => {}, stroke: () => {}, translate: () => {},
  } as unknown as CanvasRenderingContext2D;
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContext);
  const mounted = mount(ui);
  if (widthDescriptor) Object.defineProperty(HTMLElement.prototype, "clientWidth", widthDescriptor);
  else delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth;
  if (heightDescriptor) Object.defineProperty(HTMLElement.prototype, "clientHeight", heightDescriptor);
  else delete (HTMLElement.prototype as unknown as { clientHeight?: number }).clientHeight;
  const root = mounted.container.querySelector("[data-testid='benchmark-scatter']") as HTMLElement;
  const plot = mounted.container.querySelector("[data-testid='benchmark-scatter-plot']") as HTMLElement;
  const over = mounted.container.querySelector(".u-over") as HTMLElement;
  Object.defineProperty(plot, "clientWidth", { configurable: true, value: 800 });
  Object.defineProperty(over, "clientHeight", { configurable: true, value: 320 });
  root.getBoundingClientRect = () => chartRect(800, 320);
  over.getBoundingClientRect = () => chartRect(800, 320);
  return {
    container: mounted.container,
    dispose: () => {
      getContext.mockRestore();
      vi.unstubAllGlobals();
      mounted.dispose();
    },
  };
}

describe("BenchmarkScatterChart discount annotations", () => {
  it("keeps Pareto DOM and crowns absent by default, then removes them when disabled", async () => {
    const [showFrontier, setShowFrontier] = createSignal(false);
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={() => [
          { id: "cheap", label: "Cheap", x: 2, y: 60 },
          { id: "better", label: "Better", x: 4, y: 75 },
          { id: "dominated", label: "Dominated", x: 8, y: 70 },
        ]}
        scale={() => "linear"}
        showFrontier={showFrontier}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelector("[data-testid='pareto-crown']")).toBeNull();
    setShowFrontier(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelector("[data-testid='pareto-crown']")).not.toBeNull();
    expect(container.querySelector("[data-testid='chart-decorations']")?.querySelectorAll("[data-testid='pareto-crown']")).toHaveLength(2);
    setShowFrontier(false);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelector("[data-testid='pareto-crown']")).toBeNull();
    dispose();
  });

  it("renders one horizontal percentage arrow for each explicit source discount", async () => {
    const initialPoints: readonly PlottablePoint[] = [
      {
        id: "discounted-model",
        label: "Discounted model",
        x: 6,
        y: 70,
        discount: { percentage: 40, preDiscountX: 10, providerName: "Provider A" },
      },
      { id: "regular-model", label: "Regular model", x: 12, y: 80 },
    ];
    const [points, setPoints] = createSignal<readonly PlottablePoint[]>(initialPoints);
    const [scale, setScale] = createSignal<"log" | "linear">("log");
    const { container, dispose } = mount(() => (
      <BenchmarkScatterChart
        points={points}
        scale={scale}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const arrows = container.querySelectorAll("[data-testid='discount-line']");
    expect(arrows).toHaveLength(1);
    expect(arrows[0]?.getAttribute("data-discount-id")).toBe("discounted-model");
    expect(arrows[0]?.getAttribute("data-discount-percentage")).toBe("40");
    expect(arrows[0]?.querySelector("line")).not.toBeNull();
    expect(arrows[0]?.querySelector("path")).toBeNull();

    setScale("linear");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelectorAll("[data-testid='discount-line']")).toHaveLength(1);

    setPoints([initialPoints[1]!]);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelectorAll("[data-testid='discount-line']")).toHaveLength(0);
    dispose();
  });

  it("keeps a valid 100% annotation while omitting its zero log-scale endpoint", async () => {
    const [scale, setScale] = createSignal<"log" | "linear">("log");
    const { container, dispose } = mount(() => (
      <BenchmarkScatterChart
        points={() => [{
          id: "free-model",
          label: "Free model",
          x: 6,
          y: 70,
          discount: { percentage: 100, preDiscountX: 10, effectiveX: 0 },
        }]}
        scale={scale}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    // The source annotation remains available to plot-data labels/tooltips;
    // this chart intentionally omits a zero endpoint rather than sending it
    // through uPlot's logarithmic x scale.
    expect(container.querySelectorAll("[data-testid='discount-line']")).toHaveLength(0);
    setScale("linear");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelectorAll("[data-testid='discount-line']")).toHaveLength(1);
    dispose();
  });

  it("coalesces rapid point updates and renders the latest data", async () => {
    const [points, setPoints] = createSignal<readonly PlottablePoint[]>([
      { id: "first", label: "First", x: 6, y: 70, discount: { percentage: 10, preDiscountX: 8 } },
    ]);
    const { container, dispose } = mount(() => (
      <BenchmarkScatterChart
        points={points}
        scale={() => "log"}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const requestFrame = vi.spyOn(window, "requestAnimationFrame");
    for (let index = 0; index < 100; index += 1) {
      setPoints([{
        id: `model-${index}`,
        label: `Model ${index}`,
        x: index + 1,
        y: 70,
        discount: { percentage: index, preDiscountX: index + 2 },
      }]);
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelector("[data-testid='discount-line']")?.getAttribute("data-discount-id")).toBe("model-99");
    // One frame-coalesced render handles all 100 slider updates; no
    // update/render feedback loop can enqueue one render per input.
    expect(requestFrame.mock.calls.length).toBeLessThanOrEqual(4);
    dispose();
    requestFrame.mockRestore();
  });

  it("keeps model labels passive and removes standalone discount labels", async () => {
    const { container, dispose } = mount(() => (
      <BenchmarkScatterChart
        points={() => [{ id: "model", label: "Model", x: 6, y: 70, discount: { percentage: 40, preDiscountX: 10 } }]}
        scale={() => "log"}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelector("[data-testid='discount-label']")).toBeNull();
    expect(container.querySelector("[data-testid='label-hover-highlight']")).toBeNull();
    dispose();
  });

  it("emphasizes one family label and connector, then restores de-emphasis", async () => {
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={() => [
          { id: "opus-low", label: "Opus low", x: 4, y: 60, brand: "anthropic", effortGroup: "opus", effort: "low" },
          { id: "opus-high", label: "Opus high", x: 6, y: 70, brand: "anthropic", effortGroup: "opus", effort: "high" },
          { id: "other", label: "Other", x: 12, y: 80, brand: "openai" },
        ]}
        scale={() => "linear"}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const familyLabel = container.querySelector("[data-testid='model-label'][data-model-id='opus-high']") as HTMLElement;
    const otherLabel = container.querySelector("[data-testid='model-label'][data-model-id='other']") as HTMLElement;
    expect(familyLabel).not.toBeNull();
    expect(otherLabel).not.toBeNull();
    familyLabel.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(familyLabel.style.opacity).toBe("1");
    expect(otherLabel.style.opacity).toBe("0.2");
    expect(container.querySelectorAll("[data-testid='focused-connector']")).toHaveLength(1);
    familyLabel.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(otherLabel.style.opacity).toBe("1");
    expect(container.querySelectorAll("[data-testid='focused-connector']")).toHaveLength(0);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    dispose();
  });

  it("renders only the largest provider discount for one model and can hide it", async () => {
    const [showDiscounts, setShowDiscounts] = createSignal(true);
    const { container, dispose } = mount(() => (
      <BenchmarkScatterChart
        points={() => [{
          id: "multi-discount",
          label: "Multi discount",
          x: 6,
          y: 70,
          discounts: [
            { percentage: 40, preDiscountX: 10, effectiveX: 6, providerName: "Provider A" },
            { percentage: 25, preDiscountX: 8, effectiveX: 5, providerName: "Provider B" },
          ],
        }]}
        scale={() => "log"}
        showDiscounts={showDiscounts}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const arrows = container.querySelectorAll("[data-testid='discount-line']");
    expect(arrows).toHaveLength(1);
    expect(arrows[0]?.getAttribute("data-discount-id")).toBe("multi-discount");
    expect(arrows[0]?.getAttribute("data-discount-percentage")).toBe("40");
    setShowDiscounts(false);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelectorAll("[data-testid='discount-line']")).toHaveLength(0);
    dispose();
  });
});
