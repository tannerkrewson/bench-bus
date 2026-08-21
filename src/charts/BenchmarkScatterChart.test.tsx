import { describe, expect, it } from "vitest";
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
        selectedId={() => null}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const arrows = container.querySelectorAll("[data-testid='discount-arrow']");
    expect(arrows).toHaveLength(1);
    expect(arrows[0]?.getAttribute("data-discount-id")).toBe("discounted-model");
    expect(arrows[0]?.getAttribute("data-discount-percentage")).toBe("40");
    expect(arrows[0]?.querySelector("path")?.getAttribute("d")).toMatch(/^M /);
    expect(arrows[0]?.textContent).toContain("40% off");

    setScale("linear");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelectorAll("[data-testid='discount-arrow']")).toHaveLength(1);

    setPoints([initialPoints[1]!]);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelectorAll("[data-testid='discount-arrow']")).toHaveLength(0);
    dispose();
  });

  it("renders multiple provider discount arrows for one model", async () => {
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
        selectedId={() => null}
        xAxisLabel={() => "Cost"}
        yAxisLabel={() => "Score"}
        height={320}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const arrows = container.querySelectorAll("[data-testid='discount-arrow']");
    expect(arrows).toHaveLength(2);
    expect(arrows[0]?.getAttribute("data-discount-id")).toBe("multi-discount::discount-0");
    expect(arrows[1]?.getAttribute("data-discount-id")).toBe("multi-discount::discount-1");
    dispose();
  });
});
