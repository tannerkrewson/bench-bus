import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import type { JSX } from "solid-js";
import BenchmarkChartSection from "./BenchmarkChartSection";
import ChartTooltip from "../charts/ChartTooltip";import {
  AA_FIXTURE_RECORDS,
  CURSOR_FIXTURE_RECORDS,
  aaDemoAdapter,
  cursorDemoAdapter,
} from "../charts/fixtures";
import { chartStateFromParams } from "../charts/urlState";
import type { ChartViewState } from "../charts/types";

function mount(ui: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(ui, container);
  return { container, dispose: () => { dispose(); container.remove(); } };
}

describe("BenchmarkChartSection (AA fixture shape)", () => {
  it("renders controls, plotted models, and surfaces unplottable models", () => {
    const { container, dispose } = mount(() => (
      <BenchmarkChartSection adapter={aaDemoAdapter} records={() => AA_FIXTURE_RECORDS} />
    ));

    expect(container.querySelector("section[data-benchmark='aa-demo']")).not.toBeNull();
    expect(container.querySelector("canvas")).not.toBeNull();

    // Pricing controls from the adapter.
    expect(container.querySelector("#chart-control-pricingMode")).not.toBeNull();
    expect(container.querySelector("#chart-control-cacheHitRate")).not.toBeNull();
    expect(
      (container.querySelector("#chart-control-cacheHitRate") as HTMLInputElement).value,
    ).toBe("0.9");

    // 3 plotted + 1 unplottable (no providers) in the model list.
    const buttons = container.querySelectorAll("[data-testid='model-list'] button");
    expect(buttons).toHaveLength(3);
    expect(container.textContent).toContain("Mystery Model (no pricing)");
    dispose();
  });

  it("switches log/linear and preserves query and selection state", () => {
    const states: ChartViewState[] = [];
    const { container, dispose } = mount(() => (
      <BenchmarkChartSection
        adapter={aaDemoAdapter}
        records={() => AA_FIXTURE_RECORDS}
        onStateChange={(s) => states.push(s)}
      />
    ));

    const logBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Log",
    )!;
    const linearBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Linear",
    )!;
    expect(logBtn.getAttribute("aria-pressed")).toBe("true");

    // Establish selection + query first.
    const search = container.querySelector("#benchmark-chart-search") as HTMLInputElement;
    search.value = "gemini";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    linearBtn.click();
    expect(linearBtn.getAttribute("aria-pressed")).toBe("true");
    expect(logBtn.getAttribute("aria-pressed")).toBe("false");
    expect((container.querySelector("#benchmark-chart-search") as HTMLInputElement).value).toBe(
      "gemini",
    );
    const last = states[states.length - 1]!;
    expect(last.scale).toBe("linear");
    expect(last.query).toBe("gemini");
    dispose();
  });

  it("updates selection in place without remounting the section", () => {
    const { container, dispose } = mount(() => (
      <BenchmarkChartSection adapter={aaDemoAdapter} records={() => AA_FIXTURE_RECORDS} />
    ));

    const section = container.querySelector("section[data-benchmark='aa-demo']")!;
    const modelButton = container.querySelector("[data-testid='model-list'] button")!;
    (modelButton as HTMLButtonElement).click();
    expect(modelButton.getAttribute("aria-pressed")).toBe("true");

    // Same DOM node: no full-app recreation happened.
    expect(container.querySelector("section[data-benchmark='aa-demo']")).toBe(section);
    dispose();
  });

  it("restores state from parsed URL params", () => {
    const params = new URLSearchParams(
      "chart.aa-demo.scale=linear&chart.aa-demo.c.cacheHitRate=0.5&chart.aa-demo.sel=claude-opus-5",
    );
    const initial = chartStateFromParams(params, "aa-demo", aaDemoAdapter.controlSpecs, {
      scale: aaDemoAdapter.defaultXScale,
      controls: { pricingMode: "cheapest", cacheHitRate: 0.9 },
    });
    const { container, dispose } = mount(() => (
      <BenchmarkChartSection
        adapter={aaDemoAdapter}
        records={() => AA_FIXTURE_RECORDS}
        initialState={initial}
      />
    ));

    expect((container.querySelector("#chart-control-cacheHitRate") as HTMLInputElement).value).toBe(
      "0.5",
    );
    const linearBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Linear",
    )!;
    expect(linearBtn.getAttribute("aria-pressed")).toBe("true");
    const selected = container.querySelector("[data-testid='model-list'] button[aria-pressed='true']");
    expect(selected?.textContent).toBe("Claude Opus 5");
    dispose();
  });

  it("shows the empty state when there are no records", () => {
    const { container, dispose } = mount(() => (
      <BenchmarkChartSection adapter={aaDemoAdapter} records={() => []} />
    ));
    expect(container.querySelector("[data-testid='chart-empty']")).not.toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
    dispose();
  });

  it("shows the no-points state when every record is unplottable", () => {
    const unpriced = CURSOR_FIXTURE_RECORDS.map((r) => ({ ...r, publishedCostUsd: undefined }));
    const adapter = { ...cursorDemoAdapter, benchmarkId: "cursor-none" };
    const { container, dispose } = mount(() => (
      <BenchmarkChartSection adapter={adapter} records={() => unpriced} />
    ));
    expect(container.querySelector("[data-testid='chart-no-points']")).not.toBeNull();
    dispose();
  });
});

describe("BenchmarkChartSection (Cursor fixture shape)", () => {
  it("applies the surcharge toggle and reports state changes", () => {
    const states: ChartViewState[] = [];
    const { container, dispose } = mount(() => (
      <BenchmarkChartSection
        adapter={cursorDemoAdapter}
        records={() => CURSOR_FIXTURE_RECORDS}
        onStateChange={(s) => states.push(s)}
      />
    ));

    const toggle = container.querySelector("input[type='checkbox']") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    toggle.click();
    expect(toggle.checked).toBe(true);
    const last = states[states.length - 1]!;
    expect(last.controls.surcharge).toBe(true);
    dispose();
  });
});

describe("ChartTooltip", () => {
  it("renders title and lines when hovered, nothing when not", () => {
    const [title, setTitle] = createSignal<string | null>(null);
    const { container, dispose } = mount(() => (
      <ChartTooltip
        left={() => 10}
        top={() => 10}
        title={title}
        lines={() => [{ label: "Score", value: "71.2" }]}
      />
    ));
    expect(container.querySelector("[data-testid='chart-tooltip']")).toBeNull();
    setTitle("Claude Opus 5");
    const tip = container.querySelector("[data-testid='chart-tooltip']");
    expect(tip?.textContent).toContain("Claude Opus 5");
    expect(tip?.textContent).toContain("71.2");
    dispose();
  });
});
