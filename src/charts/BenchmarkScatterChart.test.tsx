import { describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import BenchmarkScatterChart, {
  crosshairGuideGeometry,
  filterDollarAxisSplits,
  filterIntegerAxisSplits,
  filterLogDollarAxisSplits,
  formatFilteredAxisValues,
  filterTenPointGridSplits,
  seriesAlphasForFocus,
  snapToDotPosition,
} from "./BenchmarkScatterChart";
import type { PlottablePoint } from "./types";

describe("BenchmarkScatterChart pure interaction policies", () => {
  it("filters axis and grid splits without changing accepted values", () => {
    expect(filterDollarAxisSplits([0.5, Number.NaN, 1_000])).toEqual([0.5, null, 1_000]);
    expect(filterLogDollarAxisSplits([
      0.001, 0.002, 0.01, 0.02, 0.1, 0.2, 1, 2, 10, 20, 100,
    ])).toEqual([
      0.001, null, 0.01, null, 0.1, null, 1, null, 10, null, 100,
    ]);
    expect(filterLogDollarAxisSplits([0.003, 0.01, 0.02, 0.3])).toEqual([0.003, 0.01, null, 0.3]);
    expect(filterIntegerAxisSplits([69, 69.5, 70])).toEqual([69, null, 70]);
    expect(filterTenPointGridSplits([60, 65, 70, 70.5])).toEqual([60, null, 70, null]);
  });

  it("formats filtered axis splits as blank labels instead of literal null", () => {
    expect(formatFilteredAxisValues([69, null, 70], String)).toEqual(["69", "", "70"]);
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

  it("keeps every focused family point and connector series at its base alpha", () => {
    const focusedAlphas = seriesAlphasForFocus(
      [1, 0.62, 0.62, 1, 1, 1, 1],
      true,
      2,
      1,
      ["opus", "other"],
      0,
      new Set(["opus"]),
    );
    expect(focusedAlphas).toEqual([0.2, 0.62, 0.2, 0.2, 1, 0.2, 0.2]);
    expect(seriesAlphasForFocus(
      [1, 0.62, 0.62, 1, 1, 1, 1],
      false,
      2,
      1,
      ["opus", "other"],
      null,
      null,
    )).toEqual([1, 0.62, 0.62, 1, 1, 1, 1]);
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
  it("keeps Pareto crowns visible independently of the frontier line toggle", async () => {
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
    expect(container.querySelector("[data-testid='chart-decorations']")?.querySelectorAll("[data-testid='pareto-crown']")).toHaveLength(2);
    setShowFrontier(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelector("[data-testid='chart-decorations']")?.querySelectorAll("[data-testid='pareto-crown']")).toHaveLength(2);
    setShowFrontier(false);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelector("[data-testid='chart-decorations']")?.querySelectorAll("[data-testid='pareto-crown']")).toHaveLength(2);
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
    expect(arrows[0]?.querySelector("line")?.getAttribute("stroke-dasharray")).toBe("1 4");
    expect(arrows[0]?.querySelector("line")?.getAttribute("stroke-width")).toBe("1");
    expect(arrows[0]?.getAttribute("stroke-dasharray")).toBe("1 4");
    expect(arrows[0]?.getAttribute("stroke-width")).toBe("1");
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

  it("refreshes family connector overlays after repeated plot updates", async () => {
    const [points, setPoints] = createSignal<readonly PlottablePoint[]>([
      { id: "opus-low", label: "Opus low", x: 4, y: 60, effortGroup: "opus", effort: "low" },
      { id: "opus-high", label: "Opus high", x: 6, y: 70, effortGroup: "opus", effort: "high" },
    ]);
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={points}
        scale={() => "linear"}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelectorAll("[data-testid='family-connector-hit']")).toHaveLength(1);
    for (let value = 0; value < 20; value += 1) {
      setPoints([
        { id: "opus-low", label: "Opus low", x: 4 + value, y: 60, effortGroup: "opus", effort: "low" },
        { id: "opus-high", label: "Opus high", x: 6 + value, y: 70, effortGroup: "opus", effort: "high" },
      ]);
    }
    setPoints([{ id: "opus-low", label: "Opus low", x: 24, y: 60, effortGroup: "opus", effort: "low" }]);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelectorAll("[data-testid='family-connector-hit']")).toHaveLength(0);
    dispose();
  });

  it("appends discount text to model labels and removes standalone discount labels", async () => {
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={() => [{ id: "model", label: "Model", x: 6, y: 70, discount: { percentage: 43.1, preDiscountX: 10 } }]}
        scale={() => "log"}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelector("[data-testid='model-label']")?.textContent).toBe("Model 43.1% off");
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
    expect(container.querySelectorAll("[data-testid='focused-model-dot']")).toHaveLength(2);
    expect(container.querySelector("[data-testid='focused-model-dot'][data-model-id='opus-low']")).not.toBeNull();
    expect(container.querySelector("[data-testid='focused-model-dot'][data-model-id='opus-high']")).not.toBeNull();
    familyLabel.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(otherLabel.style.opacity).toBe("1");
    expect(container.querySelectorAll("[data-testid='focused-connector']")).toHaveLength(0);

    const connector = container.querySelector("[data-testid='family-connector-hit']") as SVGLineElement;
    expect(connector).not.toBeNull();
    connector.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(container.querySelector("[data-hovered-label-id='opus-high']")).not.toBeNull();
    expect(familyLabel.style.opacity).toBe("1");
    expect(otherLabel.style.opacity).toBe("0.2");
    expect(container.querySelectorAll("[data-testid='focused-connector']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-testid='focused-model-dot']")).toHaveLength(2);
    connector.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(container.querySelector("[data-hovered-label-id]")).toBeNull();
    expect(otherLabel.style.opacity).toBe("1");
    expect(container.querySelectorAll("[data-testid='focused-connector']")).toHaveLength(0);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    dispose();
  });

  it("keeps raw overlay pointer coordinates in uPlot transform space", async () => {
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={() => [
          { id: "first", label: "First", x: 4, y: 60 },
          { id: "second", label: "Second", x: 12, y: 80 },
        ]}
        scale={() => "linear"}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const root = container.querySelector("[data-testid='benchmark-scatter']") as HTMLElement;
    const vertical = container.querySelector(".u-cursor-x") as HTMLElement;
    const horizontal = container.querySelector(".u-cursor-y") as HTMLElement;
    root.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 123, clientY: 87 }));
    expect(vertical.style.left).toBe("0px");
    expect(vertical.style.transform).toBe("translate(123px,0px)");
    expect(horizontal.style.transform).toBe("translate(0px,87px)");
    expect(vertical.style.height).toBe("233px");
    const label = container.querySelector("[data-testid='model-label']") as HTMLElement;
    expect(label).not.toBeNull();
    const labelLeft = Number.parseFloat(label.style.left) + 2;
    const labelTop = Number.parseFloat(label.style.top) + 2;
    label.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: labelLeft,
      clientY: labelTop,
    }));
    expect(container.querySelector("[data-testid='hovered-dot']")).toBeNull();
    expect(vertical.style.left).toBe("0px");
    expect(vertical.style.transform).toBe(`translate(${labelLeft}px,0px)`);
    expect(horizontal.style.transform).toBe(`translate(0px,${labelTop}px)`);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    dispose();
  });

  it("snaps guides and the hover circle only for a direct dot hit", async () => {
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={() => [
          { id: "opus-low", label: "Opus low", x: 4, y: 60, effortGroup: "opus", effort: "low" },
          { id: "opus-high", label: "Opus high", x: 8, y: 80, effortGroup: "opus", effort: "high" },
          { id: "other", label: "Other", x: 14, y: 70 },
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
    familyLabel.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    const dot = container.querySelector("[data-testid='focused-model-dot'][data-model-id='opus-low']") as SVGCircleElement;
    const left = Number.parseFloat(dot.getAttribute("cx")!);
    const top = Number.parseFloat(dot.getAttribute("cy")!);
    const root = container.querySelector("[data-testid='benchmark-scatter']") as HTMLElement;
    root.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: left, clientY: top }));
    expect(container.querySelector("[data-testid='hovered-dot']")).not.toBeNull();
    const vertical = container.querySelector(".u-cursor-x") as HTMLElement;
    const horizontal = container.querySelector(".u-cursor-y") as HTMLElement;
    expect(vertical.style.transform).toBe(`translate(${left}px,0px)`);
    expect(horizontal.style.transform).toBe(`translate(0px,${top}px)`);
    root.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: left + 40, clientY: top + 40 }));
    expect(container.querySelector("[data-testid='hovered-dot']")).toBeNull();
    expect(vertical.style.transform).toBe(`translate(${left + 40}px,0px)`);
    expect(horizontal.style.transform).toBe(`translate(0px,${top + 40}px)`);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    dispose();
  });

  it("clears label emphasis when labels are hidden and stays neutral when re-enabled", async () => {
    const [showLabels, setShowLabels] = createSignal(true);
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={() => [
          { id: "opus-low", label: "Opus low", x: 4, y: 60, brand: "anthropic", effortGroup: "opus", effort: "low" },
          { id: "opus-high", label: "Opus high", x: 6, y: 70, brand: "anthropic", effortGroup: "opus", effort: "high" },
          { id: "other", label: "Other", x: 12, y: 80, brand: "openai" },
        ]}
        scale={() => "linear"}
        showLabels={showLabels}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const familyLabel = container.querySelector("[data-testid='model-label'][data-model-id='opus-high']") as HTMLElement;
    const otherLabel = container.querySelector("[data-testid='model-label'][data-model-id='other']") as HTMLElement;
    familyLabel.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(container.querySelector("[data-hovered-label-id='opus-high']")).not.toBeNull();
    expect(otherLabel.style.opacity).toBe("0.2");

    setShowLabels(false);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelector("[data-hovered-label-id]")).toBeNull();
    expect(container.querySelectorAll("[data-testid='model-label']")).toHaveLength(0);
    expect(container.querySelectorAll("[data-testid='focused-connector'], [data-testid='focused-model-dot']")).toHaveLength(0);

    setShowLabels(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelector("[data-hovered-label-id]")).toBeNull();
    expect(container.querySelectorAll("[data-testid='model-label']")).not.toHaveLength(0);
    expect([...container.querySelectorAll<HTMLElement>("[data-testid='model-label']")].every((label) => label.style.opacity === "1")).toBe(true);
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
