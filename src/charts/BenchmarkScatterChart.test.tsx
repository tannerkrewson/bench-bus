import { describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import BenchmarkScatterChart from "./BenchmarkScatterChart";
import type { PlottablePoint } from "./types";

function mount(ui: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(ui, container);
  return { container, dispose: () => { dispose(); container.remove(); } };
}

describe("BenchmarkScatterChart discount annotations", () => {
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
