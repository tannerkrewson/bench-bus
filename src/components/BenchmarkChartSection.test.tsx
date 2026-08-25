import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import type { JSX } from "solid-js";
import BenchmarkChartSection from "./BenchmarkChartSection";
import ChartTooltip from "../charts/ChartTooltip";
import {
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
    const title = container.querySelector("h2#chart-title-aa-demo") as HTMLHeadingElement;
    const titleLink = title?.querySelector("a[data-testid='chart-title-link']") as HTMLAnchorElement;
    expect(title?.textContent).toBe("Artificial Analysis model value");
    expect(titleLink?.getAttribute("href")).toBe("#chart-title-aa-demo");
    expect(titleLink?.textContent).toBe("Artificial Analysis model value");
    expect(container.querySelector("canvas")).not.toBeNull();

    // Pricing controls from the adapter.
    expect(container.querySelector("#chart-aa-demo-control-pricingMode")).not.toBeNull();
    expect(container.querySelector("#chart-aa-demo-control-cacheHitRate")).not.toBeNull();
    expect(
      (container.querySelector("#chart-aa-demo-control-cacheHitRate") as HTMLInputElement).value,
    ).toBe("0.9");

    // 3 plotted + 1 unplottable (no providers) in the model list.
    const checkboxes = container.querySelectorAll("[data-testid='model-list'] input[type='checkbox']");
    expect(checkboxes).toHaveLength(3);
    expect(container.textContent).toContain("Mystery Model");
    expect(container.textContent).toContain("no pricing");
    const modelLabels = container.querySelectorAll("[data-testid='model-list'] span[title]");
    expect(modelLabels.length).toBeGreaterThan(0);
    modelLabels.forEach((label) => expect(label.classList.contains("truncate")).toBe(false));
    dispose();
  });

  it("opens chart settings as an accessible popover and keeps the legend below the graph", () => {
    const { container, dispose } = mount(() => (
      <BenchmarkChartSection adapter={aaDemoAdapter} records={() => AA_FIXTURE_RECORDS} />
    ));

    const settings = container.querySelector("summary[aria-label='Chart settings']") as HTMLElement;
    expect(settings).not.toBeNull();
    expect(settings.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("[data-testid='chart-settings'] summary button")).toBeNull();
    const details = container.querySelector("[data-testid='chart-settings']") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    settings.click();
    expect(details.open).toBe(true);
    expect(settings.getAttribute("aria-expanded")).toBe("true");
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(details.open).toBe(false);
    settings.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(details.open).toBe(false);
    const watermark = container.querySelector("[data-testid='chart-watermark']") as HTMLElement;
    expect(watermark).not.toBeNull();
    expect(watermark.parentElement?.className).toContain("absolute");
    expect(watermark.parentElement?.className).toContain("bottom-20");
    expect(watermark.parentElement?.className).toContain("left-32");
    expect(watermark.parentElement?.className).toContain("bg-base-100/90");
    expect(watermark.getAttribute("aria-label")).toBe("Bench Bus watermark, benchb.us");
    expect(container.querySelector("[data-testid='chart-area']")?.className).toContain("min-h-");
    const scroll = container.querySelector("[data-testid='chart-scroll']") as HTMLElement;
    const scrollContent = container.querySelector("[data-testid='chart-scroll-content']") as HTMLElement;
    expect(scroll.className).toContain("overflow-x-auto");
    expect(scrollContent.className).toContain("min-w-[720px]");
    expect(scrollContent.className).toContain("sm:min-w-0");
    dispose();
  });

  it("keeps crown visibility default-on and independent from the frontier line", () => {
    const { container, dispose } = mount(() => (
      <BenchmarkChartSection adapter={aaDemoAdapter} records={() => AA_FIXTURE_RECORDS} />
    ));
    const crowns = container.querySelector("input[aria-label='Show Pareto crowns']") as HTMLInputElement;
    const frontier = container.querySelector("input[aria-label='Show Pareto frontier']") as HTMLInputElement;
    expect(crowns.checked).toBe(true);
    expect(container.querySelector("[aria-label^='Pareto crown']")).not.toBeNull();
    crowns.click();
    expect(crowns.checked).toBe(false);
    expect(container.querySelector("[aria-label^='Pareto crown']")).toBeNull();
    frontier.click();
    expect(frontier.checked).toBe(true);
    expect(container.querySelector("[aria-label='Pareto frontier (dotted line)']")).not.toBeNull();
    expect(crowns.checked).toBe(false);
    dispose();
  });

  it("makes the settings popup translucent only during slider interaction and keeps it below the button", () => {
    const { container, dispose } = mount(() => (
      <BenchmarkChartSection adapter={aaDemoAdapter} records={() => AA_FIXTURE_RECORDS} />
    ));
    const settings = container.querySelector("summary[aria-label='Chart settings']") as HTMLElement;
    const popup = container.querySelector("[data-testid='chart-settings-popup']") as HTMLElement;
    const panel = container.querySelector("[data-testid='chart-controls']") as HTMLElement;
    const slider = container.querySelector("input[type='range']") as HTMLInputElement;

    settings.click();
    expect(popup.getAttribute("role")).toBe("dialog");
    expect(popup.getAttribute("aria-label")).toBe("Chart settings");
    expect(popup.classList.contains("top-full")).toBe(true);
    expect(popup.classList.contains("right-0")).toBe(true);
    expect(panel.style.opacity).toBe("1");
    slider.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(panel.style.opacity).toBe("0.2");
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(panel.style.opacity).toBe("1");
    slider.dispatchEvent(new Event("touchstart", { bubbles: true }));
    expect(panel.style.opacity).toBe("0.2");
    document.dispatchEvent(new Event("touchcancel", { bubbles: true }));
    expect(panel.style.opacity).toBe("1");
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
    const search = container.querySelector("#chart-aa-demo-model-search") as HTMLInputElement;
    search.value = "gemini";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    linearBtn.click();
    expect(linearBtn.getAttribute("aria-pressed")).toBe("true");
    expect(logBtn.getAttribute("aria-pressed")).toBe("false");
    expect((container.querySelector("#chart-aa-demo-model-search") as HTMLInputElement).value).toBe(
      "gemini",
    );
    const last = states[states.length - 1]!;
    expect(last.scale).toBe("linear");
    expect(last.query).toBe("gemini");
    dispose();
  });

  it("keeps all plotted models visible while filtering selector options", () => {
    const { container, dispose } = mount(() => (
      <BenchmarkChartSection adapter={aaDemoAdapter} records={() => AA_FIXTURE_RECORDS} />
    ));
    const before = container.querySelectorAll("[data-testid='model-label']").length;
    const search = container.querySelector("#chart-aa-demo-model-search") as HTMLInputElement;
    search.value = "gemini";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(container.querySelectorAll("[data-testid='model-label']")).toHaveLength(before);
    expect(container.querySelector("[data-testid='chart-no-points']")).toBeNull();
    dispose();
  });

  it("updates selection in place without remounting the section", () => {
    const { container, dispose } = mount(() => (
      <BenchmarkChartSection adapter={aaDemoAdapter} records={() => AA_FIXTURE_RECORDS} />
    ));

    const section = container.querySelector("section[data-benchmark='aa-demo']")!;
    const modelCheckbox = container.querySelector("[data-testid='model-list'] input[type='checkbox']")!;
    (modelCheckbox as HTMLInputElement).click();
    expect((modelCheckbox as HTMLInputElement).checked).toBe(false);
    expect(
      [...container.querySelectorAll<HTMLInputElement>("[data-testid='model-list'] input[type='checkbox']")]
        .filter((checkbox) => checkbox.checked),
    ).toHaveLength(2);

    const clear = [...container.querySelectorAll("[data-testid='model-list'] button")].find(
      (button) => button.textContent === "Clear",
    )!;
    clear.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(
      [...container.querySelectorAll<HTMLInputElement>("[data-testid='model-list'] input[type='checkbox']")]
        .some((checkbox) => checkbox.checked),
    ).toBe(false);

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

    expect((container.querySelector("#chart-aa-demo-control-cacheHitRate") as HTMLInputElement).value).toBe(
      "0.5",
    );
    const linearBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Linear",
    )!;
    expect(linearBtn.getAttribute("aria-pressed")).toBe("true");
    const selected = container.querySelector(
      "[data-testid='model-list'] input[aria-label='Show Claude Opus 5']",
    ) as HTMLInputElement;
    expect(selected.checked).toBe(true);
    dispose();
  });

  it("honors an explicitly empty selection instead of treating it as all models", () => {
    const params = new URLSearchParams("chart.aa-demo.sel=");
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
    expect(container.querySelector("[data-testid='chart-no-points']")).not.toBeNull();
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

describe("Chart controls across benchmark sections", () => {
  it("namespaces IDs and preserves control labels when both charts are mounted", () => {
    const { container, dispose } = mount(() => (
      <>
        <BenchmarkChartSection adapter={aaDemoAdapter} records={() => AA_FIXTURE_RECORDS} />
        <BenchmarkChartSection adapter={cursorDemoAdapter} records={() => CURSOR_FIXTURE_RECORDS} />
      </>
    ));

    const controls = [...container.querySelectorAll("[data-testid='chart-controls']")];
    const ids = controls.flatMap((panel) =>
      [...panel.querySelectorAll<HTMLElement>("[id]")].map((element) => element.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(container.querySelector("#chart-aa-demo-model-search")).not.toBeNull();
    expect(container.querySelector("#chart-cursor-demo-model-search")).not.toBeNull();

    for (const label of container.querySelectorAll<HTMLLabelElement>("[data-testid='chart-controls'] label[for]")) {
      const control = document.getElementById(label.htmlFor);
      expect(control).not.toBeNull();
    }
    expect(controls.every((panel) => panel.querySelector("[role='group'][aria-labelledby]") !== null)).toBe(true);
    expect(controls.every((panel) => panel.querySelector("[role='img'][aria-label='Pareto frontier (dotted line)']") === null)).toBe(true);
    // Crown hit targets remain exposed as keyboard-focusable, model-specific
    // accessible images while the decorative SVG itself stays pointer-passive.
    expect(container.querySelector("[data-testid='chart-decorations']")?.getAttribute("aria-hidden")).toBeNull();
    const crowns = container.querySelectorAll("[data-testid='pareto-crown']");
    crowns.forEach((crown) => {
      expect(crown.getAttribute("aria-hidden")).toBeNull();
      expect(crown.getAttribute("role")).toBe("img");
      expect(crown.getAttribute("tabindex")).toBe("0");
    });
    dispose();
  });
});

describe("BenchmarkChartSection (Cursor fixture shape)", () => {
  it("persists Pareto visibility without changing model visibility", () => {
    const states: ChartViewState[] = [];
    const { container, dispose } = mount(() => (
      <BenchmarkChartSection
        adapter={cursorDemoAdapter}
        records={() => CURSOR_FIXTURE_RECORDS}
        onStateChange={(state) => states.push(state)}
      />
    ));
    const frontier = container.querySelector("input[aria-label='Show Pareto frontier']") as HTMLInputElement;
    expect(frontier.checked).toBe(false);
    const canvas = container.querySelector("canvas");
    frontier.click();
    expect(frontier.checked).toBe(true);
    expect(container.querySelector("[role='img'][aria-label='Pareto frontier (dotted line)']")).not.toBeNull();
    expect(container.querySelector("canvas")).toBe(canvas);
    expect(states[states.length - 1]?.showFrontier).toBe(true);
    dispose();
  });

  it("omits provider discounts when a benchmark does not support them", () => {
    const states: ChartViewState[] = [];
    const { container, dispose } = mount(() => (
      <BenchmarkChartSection
        adapter={cursorDemoAdapter}
        records={() => CURSOR_FIXTURE_RECORDS}
        showDiscountsControl={false}
        onStateChange={(state) => states.push(state)}
      />
    ));
    expect(container.querySelector("input[aria-label='Show provider discounts']")).toBeNull();
    expect(states[states.length - 1]?.showDiscounts).toBeUndefined();
    dispose();
  });

  it("keeps the model visibility selector search inside the menu", () => {
    const { container, dispose } = mount(() => (
      <BenchmarkChartSection adapter={cursorDemoAdapter} records={() => CURSOR_FIXTURE_RECORDS} />
    ));
    expect(container.querySelector("[data-testid='chart-controls'] input[type='search']")).toBeNull();
    expect(container.querySelector("[data-testid='model-list'] input[type='search']")).not.toBeNull();
    dispose();
  });

  it("applies the surcharge toggle and reports state changes", () => {
    const states: ChartViewState[] = [];
    const { container, dispose } = mount(() => (
      <BenchmarkChartSection
        adapter={cursorDemoAdapter}
        records={() => CURSOR_FIXTURE_RECORDS}
        onStateChange={(s) => states.push(s)}
      />
    ));

    const toggle = container.querySelector(
      "input[aria-label^='Third-party surcharge']",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    const labels = container.querySelector("input[aria-label='Show model labels']") as HTMLInputElement;
    const discounts = container.querySelector("input[aria-label='Show provider discounts']") as HTMLInputElement;
    expect(labels.checked).toBe(true);
    expect(discounts.checked).toBe(true);
    labels.click();
    expect(labels.checked).toBe(false);
    toggle.click();
    expect(toggle.checked).toBe(true);
    discounts.click();
    expect(discounts.checked).toBe(false);
    const last = states[states.length - 1]!;
    expect(last.controls.surcharge).toBe(true);
    expect(last.showDiscounts).toBe(false);
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
    expect(tip?.classList.contains("whitespace-normal")).toBe(true);
    expect(tip?.classList.contains("break-words")).toBe(true);
    expect(tip?.classList.contains("truncate")).toBe(false);
    dispose();
  });
});
