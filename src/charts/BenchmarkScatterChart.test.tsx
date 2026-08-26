import { describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import BenchmarkScatterChart, {
  crosshairGuideGeometry,
  DISCOUNT_SEGMENT_LENGTH,
  discountArrowheadPath,
  discountConnectorGeometry,
  filterDollarAxisSplits,
  filterIntegerAxisSplits,
  filterIntelligenceAxisSplits,
  logDollarAxisSplits,
  filterLogDollarAxisSplits,
  formatFilteredAxisValues,
  filterTenPointGridSplits,
  seriesAlphasForFocus,
  snapToDotPosition,
  pointToSegmentDistance,
  trimDiscountSegment,
  discountLineSegments,
  trimConnectorHitSegment,
  xAxisLabelForScale,
} from "./BenchmarkScatterChart";
import type { PlottablePoint } from "./types";

describe("BenchmarkScatterChart pure interaction policies", () => {
  it("filters axis and grid splits without changing accepted values", () => {
    expect(filterDollarAxisSplits([0.5, Number.NaN, 1_000])).toEqual([0.5, null, 1_000]);
    expect(logDollarAxisSplits(13.3, 6200)).toEqual([100, 1000]);
    expect(logDollarAxisSplits(0.003, 0.008)).toEqual([0.003, 0.008]);
    expect(filterLogDollarAxisSplits([
      0.001, 0.002, 0.01, 0.02, 0.1, 0.2, 1, 2, 10, 20, 100,
    ])).toEqual([
      0.001, null, 0.01, null, 0.1, null, 1, null, 10, null, 100,
    ]);
    expect(filterLogDollarAxisSplits([0.003, 0.01, 0.02, 0.3])).toEqual([0.003, 0.01, null, 0.3]);
    expect(filterIntegerAxisSplits([69, 69.5, 70])).toEqual([69, null, 70]);
    expect(filterIntelligenceAxisSplits([60, 65, 67, 70, 72.5, 75])).toEqual([60, 65, null, 70, null, 75]);
    expect(filterTenPointGridSplits([60, 65, 70, 70.5])).toEqual([60, null, 70, null]);
  });

  it("formats filtered axis splits as blank labels instead of literal null", () => {
    expect(formatFilteredAxisValues([69, null, 70], String)).toEqual(["69", "", "70"]);
  });

  it("includes both supported scale modes in the x-axis label", () => {
    expect(xAxisLabelForScale("Avg cost / task", "log")).toBe("Avg cost / task (log scale)");
    expect(xAxisLabelForScale("Avg cost / task", "linear")).toBe("Avg cost / task (linear scale)");
  });

  it("measures the nearest point on a connector segment", () => {
    expect(pointToSegmentDistance({ left: 5, top: 4 }, { left: 0, top: 0 }, { left: 10, top: 0 })).toBe(4);
    expect(pointToSegmentDistance({ left: -2, top: 0 }, { left: 0, top: 0 }, { left: 10, top: 0 })).toBe(2);
  });

  it("trims discount connectors clear of both endpoint dots", () => {
    expect(trimDiscountSegment(100, 20, 5)).toEqual({ x1: 95, x2: 25 });
    expect(trimDiscountSegment(20, 100, 5)).toEqual({ x1: 25, x2: 95 });
    expect(trimDiscountSegment(20, 28, 5)).toBeNull();
  });

  it("uses fixed endpoint runs and clamps very short spans to one segment", () => {
    const [left, right] = discountLineSegments(0, 100);
    expect(left).toEqual({ x1: 0, y1: 0, x2: DISCOUNT_SEGMENT_LENGTH, y2: 0 });
    expect(right).toEqual({ x1: 100 - DISCOUNT_SEGMENT_LENGTH, y1: 0, x2: 100, y2: 0 });
    const [longLeft, longRight] = discountLineSegments(0, 200);
    expect(longLeft!.x2 - longLeft!.x1).toBe(DISCOUNT_SEGMENT_LENGTH);
    expect(longRight!.x2 - longRight!.x1).toBe(DISCOUNT_SEGMENT_LENGTH);
    expect(longRight!.x1 - longLeft!.x2).toBeGreaterThan(right!.x1 - left!.x2);
    // Direction-independent: mirrored spans keep the same open middle.
    const [mirroredLeft, mirroredRight] = discountLineSegments(100, 0);
    expect(mirroredLeft).toEqual({ x1: 100, y1: 0, x2: 100 - DISCOUNT_SEGMENT_LENGTH, y2: 0 });
    expect(mirroredRight).toEqual({ x1: DISCOUNT_SEGMENT_LENGTH, y1: 0, x2: 0, y2: 0 });
    expect(discountLineSegments(50, 51)).toEqual([{ x1: 50, y1: 0, x2: 51, y2: 0 }]);
  });

  it("places the arrowhead at the left run's right end and the tick at the right run's left end", () => {
    const geometry = discountConnectorGeometry(100, 0);
    expect(geometry.arrowhead).toEqual({
      tipX: DISCOUNT_SEGMENT_LENGTH,
      wingX: DISCOUNT_SEGMENT_LENGTH + 4,
    });
    expect(geometry.tick).toEqual({ x: 100 - DISCOUNT_SEGMENT_LENGTH, halfHeight: 4 });
    expect(discountArrowheadPath(28, 40, 32)).toBe("M 32 36 L 28 40 L 32 44");
    expect(discountConnectorGeometry(50, 51).arrowhead).toBeNull();
  });

  it("draws dot guides left and down only for an active dot hit", () => {
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

  it("keeps connector hit lines outside direct-dot ownership", () => {
    expect(trimConnectorHitSegment({ left: 0, top: 0 }, { left: 100, top: 0 }, 14)).toMatchObject({
      x1: expect.closeTo(14),
      y1: 0,
      x2: expect.closeTo(86),
      y2: 0,
    });
    expect(trimConnectorHitSegment({ left: 0, top: 0 }, { left: 20, top: 0 }, 14)).toBeNull();
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
  it("labels the x axis and accessible chart with the active scale", async () => {
    const [scale, setScale] = createSignal<"log" | "linear">("log");
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={() => [{ id: "model", label: "Model", x: 2, y: 60 }]}
        scale={scale}
        xAxisLabel={() => "Avg cost / task"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const chart = container.querySelector("[data-testid='benchmark-scatter']")!;
    expect(chart.getAttribute("aria-label")).toContain("Avg cost / task (log scale)");

    setScale("linear");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(chart.getAttribute("aria-label")).toContain("Avg cost / task (linear scale)");
    dispose();
  });

  it("keeps Pareto crowns visible independently of the frontier line toggle", async () => {
    const [showFrontier, setShowFrontier] = createSignal(false);
    const [showCrowns, setShowCrowns] = createSignal(true);
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={() => [
          { id: "cheap", label: "Cheap", x: 2, y: 60 },
          { id: "better", label: "Better", x: 4, y: 75 },
          { id: "dominated", label: "Dominated", x: 8, y: 70 },
        ]}
        scale={() => "linear"}
        showFrontier={showFrontier}
        showCrowns={showCrowns}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const crowns = container.querySelectorAll("[data-testid='pareto-crown']");
    expect(crowns).toHaveLength(2);
    expect(crowns[0]?.getAttribute("aria-label")).toContain("Cheap");
    expect(crowns[0]?.getAttribute("title")).toBeNull();
    setShowFrontier(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelectorAll("[data-testid='pareto-crown']")).toHaveLength(2);
    setShowFrontier(false);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelectorAll("[data-testid='pareto-crown']")).toHaveLength(2);
    setShowCrowns(false);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelectorAll("[data-testid='pareto-crown']")).toHaveLength(0);
    setShowFrontier(true);
    expect(container.querySelectorAll("[data-testid='pareto-crown']")).toHaveLength(0);
    dispose();
  });

  it("shows a visible model-specific crown tooltip without a surrounding box", async () => {
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={() => [{ id: "cheap", label: "Cheap", x: 2, y: 60 }]}
        scale={() => "linear"}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const crown = container.querySelector("[data-testid='pareto-crown']") as SVGGElement;
    expect(crown.querySelector("rect")).toBeNull();
    crown.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(container.querySelector("[data-testid='pareto-crown-tooltip']")?.textContent).toContain("Cheap");
    crown.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(container.querySelector("[data-testid='pareto-crown-tooltip']")).toBeNull();
    dispose();
  });

  it("passes discount metadata when the plotted dot is hovered", async () => {
    const onHover = vi.fn();
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={() => [{
          id: "plotted",
          label: "Plotted model",
          x: 2,
          y: 60,
          discount: { percentage: 20, preDiscountX: 4, providerName: "Provider A" },
        }]}
        scale={() => "linear"}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        onHover={onHover}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const line = container.querySelector<SVGGElement>("[data-testid='discount-line']")!;
    const xPositions = [...line.querySelectorAll<SVGLineElement>("line")].flatMap((segment) => [
      Number(segment.getAttribute("x1")),
      Number(segment.getAttribute("x2")),
    ]).filter(Number.isFinite);
    const top = Number(line.querySelector("[data-testid='discount-endpoint-dot']")?.getAttribute("cy"));
    const root = container.querySelector<HTMLElement>("[data-testid='benchmark-scatter']")!;
    root.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: Math.min(...xPositions),
      clientY: top,
    }));
    expect(onHover).toHaveBeenLastCalledWith(
      "plotted",
      expect.anything(),
      {
        kind: "point",
        discount: { percentage: 20, preDiscountX: 4, providerName: "Provider A" },
      },
    );
    dispose();
  });

  it("clears a dot hover before showing the crown tooltip", async () => {
    const onHover = vi.fn();
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={() => [{
          id: "cheap",
          label: "Cheap",
          x: 2,
          y: 60,
          discount: { percentage: 20, preDiscountX: 4 },
        }]}
        scale={() => "linear"}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        onHover={onHover}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const endpoint = container.querySelector<HTMLElement>("[data-testid='discount-endpoint-hit']")!;
    endpoint.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(onHover).toHaveBeenLastCalledWith(
      "cheap",
      expect.anything(),
      { kind: "discount-endpoint", discount: { percentage: 20, preDiscountX: 4 } },
    );
    expect(container.querySelector("[data-testid='hovered-dot']")).not.toBeNull();

    const crown = container.querySelector<HTMLElement>("[data-testid='pareto-crown']")!;
    crown.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(onHover).toHaveBeenLastCalledWith(null);
    expect(container.querySelector("[data-testid='hovered-dot']")).toBeNull();
    expect(container.querySelector("[data-testid='pareto-crown-tooltip']")).not.toBeNull();
    dispose();
  });

  it("selects a model when its plotted or discount endpoint is clicked", async () => {
    const onSelectPoint = vi.fn();
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={() => [{
          id: "clickable",
          label: "Clickable",
          x: 2,
          y: 60,
          discount: { percentage: 20, preDiscountX: 4 },
        }]}
        scale={() => "linear"}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        onSelectPoint={onSelectPoint}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const endpoint = container.querySelector<HTMLElement>("[data-testid='discount-endpoint-hit']")!;
    endpoint.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 0, clientY: 0 }));
    expect(onSelectPoint).toHaveBeenCalledWith("clickable");
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
    expect(arrows[0]?.querySelectorAll("[data-discount-part='segment']")).toHaveLength(2);
    expect(arrows[0]?.querySelector("[data-discount-part='arrowhead']")).not.toBeNull();
    expect(arrows[0]?.querySelector("[data-discount-part='tick']")).not.toBeNull();
    expect(arrows[0]?.getAttribute("stroke-dasharray")).toBe("0.1 5");
    expect(container.querySelectorAll("[data-testid='focused-discount-dot']")).toHaveLength(0);
    expect(container.querySelectorAll("[data-testid='discount-endpoint-dot'][data-discount-endpoint='pre']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-testid='discount-endpoint-dot'] circle")).toHaveLength(0);
    const line = arrows[0]?.querySelector("line");
    expect([line?.getAttribute("x1"), line?.getAttribute("x2"), line?.getAttribute("y1")].every((value) => Number.isFinite(Number(value)))).toBe(true);
    expect(arrows[0]?.getAttribute("stroke-dasharray")).toBe("0.1 5");
    expect(container.querySelectorAll("[data-testid='discount-line-hit']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-testid='discount-endpoint-hit'][data-discount-endpoint='pre']")).toHaveLength(1);
    const discountHit = container.querySelector("[data-testid='discount-line-hit']") as HTMLElement;
    discountHit.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(container.querySelector("[data-hovered-label-id='discounted-model']")).not.toBeNull();
    discountHit.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    const endpointHit = container.querySelector("[data-testid='discount-endpoint-hit']") as HTMLElement;
    endpointHit.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(container.querySelector("[data-testid='hovered-dot']")).not.toBeNull();
    expect(container.querySelector("[data-testid='hover-axis-readouts']")?.textContent).toContain("$10");
    endpointHit.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(container.querySelector("[data-testid='hovered-dot']")).toBeNull();
    expect(arrows[0]?.querySelector("[data-testid='discount-line-arrowhead']")?.getAttribute("d")).toContain("L");

    setScale("linear");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelectorAll("[data-testid='discount-line']")).toHaveLength(1);

    setPoints([initialPoints[1]!]);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelectorAll("[data-testid='discount-line']")).toHaveLength(0);
    dispose();
  });

  it("renders fixed dotted endpoint runs with an angle bracket, tick, and hollow endpoint", async () => {
    const { container, dispose } = mount(() => (
      <BenchmarkScatterChart
        points={() => [{
          id: "deepseek-v4-flash",
          label: "DeepSeek v4 Flash 0731",
          x: 6,
          y: 70,
          discount: { percentage: 43.1, preDiscountX: 10 },
        }]}
        scale={() => "log"}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const group = container.querySelector("[data-testid='discount-line']")!;
    const lines = [...group.querySelectorAll("[data-discount-part='segment']")];
    expect(lines).toHaveLength(2);
    expect(group.getAttribute("stroke-linecap")).toBe("round");
    expect(Number(group.getAttribute("stroke-width"))).toBeLessThan(2);
    // The fixed endpoint runs leave the middle of the span empty.
    const [left, right] = lines.map((line) => ({
      x1: Number(line.getAttribute("x1")),
      x2: Number(line.getAttribute("x2")),
    })).sort((a, b) => Math.min(a.x1, a.x2) - Math.min(b.x1, b.x2)) as [{ x1: number; x2: number }, { x1: number; x2: number }];
    expect(Math.abs(left.x2 - left.x1)).toBeCloseTo(DISCOUNT_SEGMENT_LENGTH, 5);
    expect(Math.abs(right.x2 - right.x1)).toBeCloseTo(DISCOUNT_SEGMENT_LENGTH, 5);
    expect(right.x1 - left.x2).toBeGreaterThan(1);
    const arrowhead = group.querySelector("[data-testid='discount-line-arrowhead']")!;
    expect(arrowhead.getAttribute("d")).toMatch(/L .+ L/);
    const tick = group.querySelector("[data-testid='discount-line-tick']")!;
    expect(tick.getAttribute("x1")).toBe(tick.getAttribute("x2"));
    expect(Number(tick.getAttribute("y2")) - Number(tick.getAttribute("y1"))).toBe(8);
    // The pre-discount endpoint dot is hollow: background fill, colored outline.
    const endpoint = container.querySelector("[data-testid='discount-endpoint-dot']")!;
    expect(endpoint.getAttribute("fill")).toBe("var(--color-base-100)");
    expect(endpoint.getAttribute("stroke-dasharray")).toBe("none");
    const endpointX = Number(endpoint.getAttribute("cx"));
    expect([left.x1, left.x2, right.x1, right.x2].some((x) => Math.abs(x - endpointX) < 1e-5)).toBe(true);
    dispose();
  });

  it("uses the plotted dot as the endpoint for an alternative-provider discount", async () => {
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={() => [{
          id: "deepseek-alternative",
          label: "DeepSeek alternative",
          x: 6,
          y: 70,
          discount: { percentage: 40, preDiscountX: 10, effectiveX: 4 },
        }]}
        scale={() => "log"}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const discount = container.querySelector("[data-testid='discount-line']")!;
    expect(discount.getAttribute("data-discount-provider-role")).toBe("alternative");
    expect(discount.querySelectorAll("[data-testid='discount-endpoint-dot']")).toHaveLength(1);
    expect(discount.querySelector("[data-discount-endpoint='effective']")).toBeNull();
    expect(container.querySelectorAll("[data-testid='discount-endpoint-hit'][data-discount-endpoint='effective']")).toHaveLength(0);
    const line = discount.querySelector("line")!;
    expect(Math.abs(Number(line.getAttribute("x2")) - Number(line.getAttribute("x1")))).toBeGreaterThan(1);
    dispose();
  });

  it("keeps sibling effort discounts emphasized when one family discount is hovered", async () => {
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={() => [
          {
            id: "model-low",
            label: "Model low",
            effortGroup: "model",
            effort: "low",
            x: 4,
            y: 60,
            discount: { percentage: 20, preDiscountX: 6 },
          },
          {
            id: "model-high",
            label: "Model high",
            effortGroup: "model",
            effort: "high",
            x: 5,
            y: 70,
            discount: { percentage: 30, preDiscountX: 8 },
          },
        ]}
        scale={() => "linear"}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const lines = [...container.querySelectorAll<SVGGElement>("[data-testid='discount-line']")];
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.getAttribute("opacity"))).toEqual(["0.75", "0.75"]);
    const firstHit = container.querySelector<HTMLElement>("[data-testid='discount-line-hit']");
    firstHit?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(lines.map((line) => line.getAttribute("opacity"))).toEqual(["0.75", "0.75"]);
    firstHit?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
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

  it("animates shared overlays when a token-rate update removes a model", async () => {
    const [points, setPoints] = createSignal<readonly PlottablePoint[]>([
      { id: "first", label: "Model", x: 4, y: 60 },
      { id: "second", label: "Model", x: 6, y: 70 },
    ]);
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={points}
        scale={() => "log"}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const before = (container.querySelector("[data-testid='model-label'][data-model-id='first']") as HTMLElement).style.left;
    const requestFrame = vi.spyOn(window, "requestAnimationFrame");
    requestFrame.mockClear();
    setPoints([{ id: "first", label: "Model", x: 12, y: 60 }]);
    await new Promise((resolve) => setTimeout(resolve, 220));
    const after = (container.querySelector("[data-testid='model-label'][data-model-id='first']") as HTMLElement).style.left;
    expect(requestFrame.mock.calls.length).toBeGreaterThan(3);
    expect(after).not.toBe(before);
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
    const initialConnector = container.querySelector("[data-testid='family-connector-hit']") as SVGLineElement;
    expect(initialConnector).not.toBeNull();
    expect(["x1", "y1", "x2", "y2"].every((name) => Number.isFinite(Number(initialConnector.getAttribute(name))))).toBe(true);
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

  it("renders a smaller parenthesized discount suffix and removes standalone discount labels", async () => {
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
    const label = container.querySelector("[data-testid='model-label']") as HTMLElement;
    const discount = container.querySelector("[data-testid='model-label-discount']") as HTMLElement;
    expect(label?.textContent).toBe("Model (43% off)");
    expect(label?.getAttribute("aria-label")).toBe("Model (43% off)");
    expect(label?.getAttribute("role")).toBe("img");
    expect(discount).not.toBeNull();
    expect(Number.parseFloat(getComputedStyle(discount).fontSize)).toBeLessThan(13);
    expect(container.querySelector("[data-testid='discount-label']")).toBeNull();
    expect(container.querySelector("[data-testid='label-hover-highlight']")).toBeNull();
    dispose();
  });

  it("uses the family base label for a singleton effort variant", async () => {
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={() => [{
          id: "opus-high",
          label: "Opus 5 high",
          x: 6,
          y: 70,
          effortGroup: "opus-5",
          effort: "high",
        }]}
        scale={() => "log"}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const label = container.querySelector("[data-testid='model-label']") as HTMLElement;
    expect(label.querySelector("[data-testid='model-label-main']")?.textContent).toBe("Opus 5");
    expect(label.getAttribute("aria-label")).toBe("Opus 5 high");
    dispose();
  });

  it("retains effort text for separate model variants and exposes full accessible names", async () => {
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={() => [
          { id: "opus", label: "Opus 5 high", x: 4, y: 60, brand: "anthropic" },
          { id: "sonnet", label: "Opus 4.8 high", x: 12, y: 80, brand: "anthropic" },
        ]}
        scale={() => "linear"}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={400}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const labels = [...container.querySelectorAll<HTMLElement>("[data-testid='model-label']")];
    expect(labels.map((label) => label.getAttribute("aria-label"))).toEqual(
      expect.arrayContaining(["Opus 5 high", "Opus 4.8 high"]),
    );
    expect(labels.map((label) => label.textContent)).toEqual(
      expect.arrayContaining(["Opus 5 high", "Opus 4.8 high"]),
    );
    dispose();
  });

  it("emphasizes one family label and connector, then restores de-emphasis", async () => {
    const { container, dispose } = mountSizedChart(() => (
      <BenchmarkScatterChart
        points={() => [
          { id: "opus-low", label: "Opus 5 low", x: 4, y: 60, brand: "anthropic", effortGroup: "opus-5", effort: "low" },
          { id: "opus-high", label: "Opus 5 high", x: 6, y: 70, brand: "anthropic", effortGroup: "opus-5", effort: "high" },
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
    expect(familyLabel.textContent).toBe("Opus 5");
    expect(familyLabel.getAttribute("aria-label")).toBe("Opus 5 high");
    expect(otherLabel).not.toBeNull();
    const root = container.querySelector("[data-testid='benchmark-scatter']") as HTMLElement;
    root.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: Number.parseFloat(familyLabel.style.left) + 2,
      clientY: Number.parseFloat(familyLabel.style.top) + 2,
    }));
    expect(familyLabel.style.opacity).toBe("1");
    expect(otherLabel.style.opacity).toBe("0.2");
    expect(container.querySelectorAll("[data-testid='focused-connector']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-testid='focused-model-dot']")).toHaveLength(2);
    const focusedDots = [...container.querySelectorAll<SVGCircleElement>("[data-testid='focused-model-dot']")];
    expect(focusedDots).toHaveLength(2);
    expect(focusedDots.every((dot) => Number(dot.getAttribute("r")) === (9 - 1.5) / 2)).toBe(true);
    expect(container.querySelector("[data-testid='focused-model-dot'][data-model-id='opus-low']")).not.toBeNull();
    expect(container.querySelector("[data-testid='focused-model-dot'][data-model-id='opus-high']")).not.toBeNull();
    root.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 300, clientY: 300 }));
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

  it("keeps guides hidden for raw pointer and label movement until a dot is hit", async () => {
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
    expect(vertical.style.height).toBe("0px");
    expect(horizontal.style.width).toBe("0px");
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
    expect(vertical.style.height).toBe("0px");
    expect(horizontal.style.width).toBe("0px");
    const dot = container.querySelector("[data-testid='focused-model-dot']") as SVGCircleElement;
    expect(dot).not.toBeNull();
    const left = Number.parseFloat(dot.getAttribute("cx")!);
    const top = Number.parseFloat(dot.getAttribute("cy")!);
    root.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: left, clientY: top }));
    expect(container.querySelector("[data-testid='hovered-dot']")).not.toBeNull();
    expect(vertical.style.transform).toBe(`translate(${left}px,0px)`);
    expect(horizontal.style.transform).toBe(`translate(0px,${top}px)`);
    expect(horizontal.style.width).toBe(`${left}px`);
    root.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: left + 40, clientY: top + 40 }));
    expect(container.querySelector("[data-testid='hovered-dot']")).toBeNull();
    expect(vertical.style.height).toBe("0px");
    expect(horizontal.style.width).toBe("0px");
    root.dispatchEvent(new MouseEvent("pointerleave", { bubbles: true, clientX: left + 40, clientY: top + 40 }));
    expect(vertical.style.height).toBe("0px");
    expect(horizontal.style.width).toBe("0px");
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 801, clientY: 120 }));
    expect(container.querySelector("[data-testid='hovered-dot']")).toBeNull();
    expect(vertical.style.height).toBe("0px");
    expect(horizontal.style.width).toBe("0px");
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
    const root = container.querySelector("[data-testid='benchmark-scatter']") as HTMLElement;
    root.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: Number.parseFloat(familyLabel.style.left) + 2,
      clientY: Number.parseFloat(familyLabel.style.top) + 2,
    }));
    const dot = container.querySelector("[data-testid='focused-model-dot'][data-model-id='opus-low']") as SVGCircleElement;
    const left = Number.parseFloat(dot.getAttribute("cx")!);
    const top = Number.parseFloat(dot.getAttribute("cy")!);
    root.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: left, clientY: top }));
    expect(container.querySelector("[data-testid='hovered-dot']")).not.toBeNull();
    expect(container.querySelectorAll("[data-testid='hover-axis-readouts'] [data-axis='x']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-testid='hover-axis-readouts'] [data-axis='y']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-testid='hover-axis-readouts'] [data-axis-end='dot']")).toHaveLength(0);
    expect(container.querySelector("[data-testid='hover-axis-readouts'] text")?.getAttribute("font-size")).toBe("14");
    expect(container.querySelector("[data-testid='hover-axis-readouts']")?.textContent).toContain("$4");
    expect(container.querySelector("[data-testid='hover-axis-readouts']")?.textContent).toContain("60.0%");
    const vertical = container.querySelector(".u-cursor-x") as HTMLElement;
    const horizontal = container.querySelector(".u-cursor-y") as HTMLElement;
    expect(vertical.style.transform).toBe(`translate(${left}px,0px)`);
    expect(horizontal.style.transform).toBe(`translate(0px,${top}px)`);
    root.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: left + 40, clientY: top + 40 }));
    expect(container.querySelector("[data-testid='hovered-dot']")).toBeNull();
    expect(vertical.style.height).toBe("0px");
    expect(horizontal.style.width).toBe("0px");
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
    const root = container.querySelector("[data-testid='benchmark-scatter']") as HTMLElement;
    root.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: Number.parseFloat(familyLabel.style.left) + 2,
      clientY: Number.parseFloat(familyLabel.style.top) + 2,
    }));
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
