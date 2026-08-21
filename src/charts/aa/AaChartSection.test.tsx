import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import AaChartSection from "./AaChartSection";
import { AA_FIXTURE_RECORDS } from "./fixtures";
import { chartStateFromParams, chartStateToParams } from "../urlState";
import { aaAdapter } from "./adapter";

function mount(ui: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(ui, container);
  return { container, dispose: () => { dispose(); container.remove(); } };
}

describe("AaChartSection", () => {
  it("renders the AA chart with pricing controls, plotted models, and unplottable models", () => {
    const { container, dispose } = mount(() => (
      <AaChartSection records={() => AA_FIXTURE_RECORDS} />
    ));

    expect(container.querySelector("section[data-benchmark='aa']")).not.toBeNull();
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(
      container.querySelector("input#chart-control-pricingMode, #chart-control-pricingMode"),
    ).not.toBeNull();
    // 3 plotted + 1 unplottable (no providers) in the default mode.
    const checkboxes = container.querySelectorAll("[data-testid='model-list'] input[type='checkbox']");
    expect(checkboxes).toHaveLength(3);
    expect(container.textContent).toContain("Mystery Model");
    expect(container.textContent).toContain("no pricing");
    expect(container.querySelector("[data-testid='aa-unplottable-count']")?.textContent).toContain(
      "1 model",
    );

    // The cache-hit control is relevant only to AA listed pricing.
    expect(container.querySelector("#chart-control-cacheHitRate")).toBeNull();
    const pricingMode = container.querySelector("#chart-control-pricingMode") as HTMLSelectElement;
    pricingMode.value = "listed";
    pricingMode.dispatchEvent(new Event("change", { bubbles: true }));
    expect(container.querySelector("#chart-control-cacheHitRate")).not.toBeNull();
    expect(
      (container.querySelector("#chart-control-cacheHitRate") as HTMLInputElement).value,
    ).toBe("0.9");
    dispose();
  });

  it("shows an empty state when there is no data", () => {
    const { container, dispose } = mount(() => <AaChartSection records={() => []} />);
    expect(container.querySelector("[data-testid='aa-empty']")).not.toBeNull();
    dispose();
  });

  it("round-trips pricing mode and cache slider through URL state", () => {
    const states: Parameters<NonNullable<Parameters<typeof AaChartSection>[0]["onStateChange"]>>[0][] =
      [];
    const { dispose } = mount(() => (
      <AaChartSection records={() => AA_FIXTURE_RECORDS} onStateChange={(s) => states.push(s)} />
    ));
    expect(states.length).toBeGreaterThan(0);
    const state = states[states.length - 1]!;
    state.controls["pricingMode"] = "listed";
    state.controls["cacheHitRate"] = 0.75;

    const qs = chartStateToParams(state, aaAdapter.benchmarkId).toString();
    expect(qs).toContain("chart.aa.c.pricingMode=listed");
    expect(qs).toContain("chart.aa.c.cacheHitRate=0.75");

    const restored = chartStateFromParams(
      new URLSearchParams(qs),
      aaAdapter.benchmarkId,
      aaAdapter.controlSpecs,
      { scale: "log", controls: { pricingMode: "cheapest", cacheHitRate: 0.9 } },
    );
    expect(restored.controls["pricingMode"]).toBe("listed");
    expect(restored.controls["cacheHitRate"]).toBe(0.75);
    dispose();
  });

  it("ignores invalid URL control values and falls back to defaults", () => {
    const restored = chartStateFromParams(
      new URLSearchParams("chart.aa.c.pricingMode=hypothetical&chart.aa.c.cacheHitRate=7"),
      aaAdapter.benchmarkId,
      aaAdapter.controlSpecs,
      { scale: "log", controls: { pricingMode: "cheapest", cacheHitRate: 0.9 } },
    );
    expect(restored.controls["pricingMode"]).toBe("cheapest");
    expect(restored.controls["cacheHitRate"]).toBe(0.9);
  });
});
