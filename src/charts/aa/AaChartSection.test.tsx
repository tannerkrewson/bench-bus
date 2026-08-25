import { describe, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import AaChartSection from "./AaChartSection";
import { AA_FIXTURE_RECORDS, AA_RECORD_PLOTTABLE_CHEAPEST, AA_RECORD_UNPLOTTABLE } from "./fixtures";
import { chartStateFromParams, chartStateToParams } from "../urlState";
import { aaAdapter } from "./adapter";
import { AA_DEFAULT_COST_MODE, AA_DEFAULT_MODEL_SLUGS } from "./constants";

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
    const title = container.querySelector("h2#chart-title-aa") as HTMLHeadingElement;
    const titleLink = title?.querySelector("a[data-testid='chart-title-link']") as HTMLAnchorElement;
    expect(title?.textContent).toBe("Best value models on OpenRouter");
    expect(titleLink?.getAttribute("href")).toBe("#chart-title-aa");
    expect(titleLink?.textContent).toBe("Best value models on OpenRouter");
    expect(container.textContent).toContain("Intelligence Index score versus estimated benchmark workload cost per task.");
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(
      container.querySelector("input#chart-aa-control-pricingMode, #chart-aa-control-pricingMode"),
    ).not.toBeNull();
    // 3 plotted + 1 unplottable (no providers) in the default mode.
    const checkboxes = container.querySelectorAll("[data-testid='model-list'] input[type='checkbox']");
    expect(checkboxes).toHaveLength(3);
    expect(container.textContent).toContain("Mystery Model");
    expect(container.textContent).toContain("no OpenRouter price");
    expect(container.textContent).toContain("Choose AA listed to use the source-listed rate");
    expect(container.querySelector("[data-testid='methodology-button-aa']")).not.toBeNull();
    expect(container.querySelector("[data-testid='chart-methodology-modal']")).not.toBeNull();
    expect(container.querySelector("[data-testid='aa-unplottable-count']")?.textContent).toContain(
      "1 model",
    );

    // The cache-hit control is relevant only to AA listed pricing.
    expect(container.querySelector("#chart-aa-control-cacheHitRate")).toBeNull();
    const pricingMode = container.querySelector("#chart-aa-control-pricingMode") as HTMLSelectElement;
    pricingMode.value = "listed";
    pricingMode.dispatchEvent(new Event("change", { bubbles: true }));
    expect(container.querySelector("#chart-aa-control-cacheHitRate")).not.toBeNull();
    expect(
      (container.querySelector("#chart-aa-control-cacheHitRate") as HTMLInputElement).value,
    ).toBe("0.9");
    dispose();
  });

  it("renders freshness as the shared accessible badge", () => {
    const timestamp = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { container, dispose } = mount(() => (
      <AaChartSection
        records={() => AA_FIXTURE_RECORDS}
        lastUpdated={() => timestamp}
      />
    ));

    const badge = container.querySelector("[data-testid='relative-last-updated']") as HTMLElement;
    expect(badge.textContent).toContain("Updated");
    expect(badge.getAttribute("aria-label")).toContain("Last updated");
    expect(container.textContent).not.toContain(" · Last updated");
    dispose();
  });

  it("labels the AA chart with its active x-axis scale", async () => {
    const { container, dispose } = mount(() => <AaChartSection records={() => AA_FIXTURE_RECORDS} />);

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const chart = container.querySelector("[data-testid='benchmark-scatter']")!;
    expect(chart.getAttribute("aria-label")).toContain("(log scale)");

    const linearBtn = [...container.querySelectorAll("button")].find((button) => button.textContent === "Linear")!;
    linearBtn.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(chart.getAttribute("aria-label")).toContain("(linear scale)");
    dispose();
  });

  it("explains a discounted model when its pre-discount endpoint is hovered", async () => {
    const discounted = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      slug: "gpt-5.6-sol-high",
      name: "GPT-5.6 Sol high",
      shortName: "GPT-5.6 Sol high",
      canonicalTokens: { input: 1_000_000, output: 1_000_000 },
      providers: [{
        providerName: "Provider A",
        providerSlug: "provider-a",
        effectiveInputPrice: 40,
        effectiveOutputPrice: 52.465,
        listedInputPrice: 80,
        listedOutputPrice: 104.93,
        discountPercentage: 50,
      }],
    };
    const { container, dispose } = mount(() => (
      <AaChartSection
        records={() => [discounted]}
        initialState={{ selectedIds: [discounted.slug], selectionSpecified: true }}
      />
    ));

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const endpoint = container.querySelector<HTMLElement>("[data-testid='discount-endpoint-hit']");
    expect(endpoint).not.toBeNull();
    endpoint?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    const tooltip = container.querySelector("[data-testid='chart-tooltip']");
    expect(tooltip?.textContent).toContain("GPT-5.6 Sol high - 50% off");
    expect(tooltip?.textContent).toContain("$184.93 - 50% = $92.47");
    expect(tooltip?.textContent).toContain("Provider: Provider A");
    expect(tooltip?.textContent).toContain("Source provider discount from Provider A");
    dispose();
  });

  it("opens the AA methodology from the chart header", () => {
    const { container, dispose } = mount(() => <AaChartSection records={() => AA_FIXTURE_RECORDS} />);
    const trigger = container.querySelector<HTMLButtonElement>("[data-testid='methodology-button-aa']")!;
    const dialog = container.querySelector<HTMLDialogElement>("[data-testid='chart-methodology-modal']")!;
    trigger.click();
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain("OpenRouter pricing");
    expect(dialog.textContent).not.toContain("CursorBench source");
    dispose();
  });

  it("renders canonical labels for verbose DeepSeek and excludes non-reasoning Luna sources", () => {
    const deepSeek = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      slug: "deepseek-v4-flash-0731",
      name: "DeepSeek V4 Flash 0731 (Reasoning, Max Effort)",
      shortName: "DeepSeek V4 Flash 0731 (Reasoning, Max Effort)",
    };
    const luna = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      slug: "gpt-5-6-luna-non-reasoning",
      name: "GPT-5.6 Luna (Non-reasoning)",
      shortName: "GPT-5.6 Luna (Non-reasoning)",
    };
    const { container, dispose } = mount(() => (
      <AaChartSection records={() => [deepSeek, luna]} />
    ));

    expect(container.textContent).toContain("DeepSeek v4 Flash 0731 max");
    expect(container.textContent).not.toContain("GPT-5.6 Luna");
    expect(container.textContent).not.toContain("Reasoning, Max Effort");
    expect(container.textContent).not.toContain("Non-reasoning");
    expect([...container.querySelectorAll<HTMLInputElement>("[data-testid='model-list'] input")]
      .map((input) => input.getAttribute("aria-label")))
      .toEqual(["Filter models by name", "Show DeepSeek v4 Flash 0731 max"]);
    dispose();
  });

  it("explains listed pricing for records unavailable in the default OpenRouter mode", () => {
    const listedOnly = {
      ...AA_RECORD_UNPLOTTABLE,
      slug: "listed-only",
      name: "Listed Only",
      listed: { price1mInputTokens: 2, price1mOutputTokens: 8, cacheHitPrice: 0.2 },
    };
    const { container, dispose } = mount(() => <AaChartSection records={() => [listedOnly]} />);
    expect(container.querySelector("[data-testid='aa-listed-availability']")?.textContent).toContain(
      "AA listed",
    );
    const pricingMode = container.querySelector("#chart-aa-control-pricingMode") as HTMLSelectElement;
    pricingMode.value = "listed";
    pricingMode.dispatchEvent(new Event("change", { bubbles: true }));
    expect(container.querySelector("[data-testid='aa-listed-availability']")).toBeNull();
    expect(container.querySelector("canvas")).not.toBeNull();
    dispose();
  });

  it("selects the requested curated defaults and keeps missing upstream models harmless", () => {
    const states: Parameters<NonNullable<Parameters<typeof AaChartSection>[0]["onStateChange"]>>[0][] =
      [];
    const { container, dispose } = mount(() => (
      <AaChartSection records={() => AA_FIXTURE_RECORDS} onStateChange={(state) => states.push(state)} />
    ));

    expect(states[states.length - 1]?.selectedIds).toEqual([
      ...AA_DEFAULT_MODEL_SLUGS,
      "gpt-5.6-sol",
    ]);
    expect(AA_DEFAULT_MODEL_SLUGS).toContain("deepseek-v4-flash");
    expect(container.querySelector("[data-testid='aa-no-points']")).toBeNull();
    expect(AA_DEFAULT_COST_MODE).toBe("intelligence-vs-cost-per-task");
    dispose();
  });

  it("includes every reasoning variant of a frontier family and excludes its non-reasoning base", () => {
    const familyBase = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      slug: "frontier-family",
      name: "Frontier Family",
      shortName: "Frontier Family",
      intelligenceIndex: 40,
      canonicalTokens: { input: 100_000_000, output: 10_000_000 },
      listed: { price1mInputTokens: 2, price1mOutputTokens: 2, cacheHitPrice: 1 },
    };
    const familyHigh = {
      ...familyBase,
      slug: "frontier-family-high",
      name: "Frontier Family High",
      intelligenceIndex: 99,
      listed: { price1mInputTokens: 0.01, price1mOutputTokens: 0.01, cacheHitPrice: 0.01 },
    };
    const familyLow = {
      ...familyBase,
      slug: "frontier-family-low",
      name: "Frontier Family (Adaptive Reasoning, Low Effort)",
      intelligenceIndex: 50,
      listed: { price1mInputTokens: 0.02, price1mOutputTokens: 0.02, cacheHitPrice: 0.01 },
    };
    const states: Parameters<NonNullable<Parameters<typeof AaChartSection>[0]["onStateChange"]>>[0][] = [];
    const { dispose } = mount(() => (
      <AaChartSection
        records={() => [...AA_FIXTURE_RECORDS, familyBase, familyHigh, familyLow]}
        onStateChange={(state) => states.push(state)}
      />
    ));
    const selected = states[states.length - 1]?.selectedIds ?? [];
    expect(selected).toContain("frontier-family-high");
    expect(selected).toContain("frontier-family-low");
    expect(selected).not.toContain("frontier-family");
    dispose();
  });

  it("updates frontier defaults with snapshots and preserves explicit selections", () => {
    const frontierRecord = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      slug: "frontier-not-curated",
      name: "Frontier Not Curated",
      shortName: "Frontier",
      intelligenceIndex: 99,
      canonicalTokens: { input: 100_000_000, output: 10_000_000 },
      listed: { price1mInputTokens: 0.1, price1mOutputTokens: 1, cacheHitPrice: 0.01 },
    };
    const replacementFrontierRecord = {
      ...frontierRecord,
      slug: "frontier-from-new-snapshot",
      name: "Frontier From New Snapshot",
      intelligenceIndex: 100,
    };
    const [records, setRecords] = createSignal<readonly typeof frontierRecord[]>([
      ...AA_FIXTURE_RECORDS,
      frontierRecord,
    ]);
    const states: Parameters<NonNullable<Parameters<typeof AaChartSection>[0]["onStateChange"]>>[0][] = [];
    const { container, dispose } = mount(() => (
      <AaChartSection records={records} onStateChange={(state) => states.push(state)} />
    ));

    expect(container.querySelectorAll("[data-testid='model-list'] input[type='checkbox']")).toHaveLength(4);
    expect(states[states.length - 1]?.selectedIds).toContain("frontier-not-curated");
    expect(AA_DEFAULT_MODEL_SLUGS).not.toContain("frontier-not-curated");
    setRecords([...AA_FIXTURE_RECORDS, replacementFrontierRecord]);
    expect(states[states.length - 1]?.selectedIds).toContain("frontier-from-new-snapshot");
    expect(states[states.length - 1]?.selectedIds).not.toContain("frontier-not-curated");
    const frontierCheckbox = container.querySelector(
      "input[aria-label='Show Frontier From New Snapshot']",
    ) as HTMLInputElement;
    frontierCheckbox.click();
    expect(states[states.length - 1]?.selectedIds).not.toContain("frontier-from-new-snapshot");
    const reset = [...container.querySelectorAll("[data-testid='model-list'] button")].find(
      (button) => button.textContent === "Reset to default",
    );
    reset?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(states[states.length - 1]?.selectedIds).toContain("frontier-from-new-snapshot");
    dispose();

    const explicitStates: Parameters<NonNullable<Parameters<typeof AaChartSection>[0]["onStateChange"]>>[0][] = [];
    const [explicitRecords, setExplicitRecords] = createSignal(AA_FIXTURE_RECORDS);
    const explicit = mount(() => (
      <AaChartSection
        records={explicitRecords}
        initialState={{ selectedIds: ["gpt-5.6-sol"], selectionSpecified: true }}
        onStateChange={(state) => explicitStates.push(state)}
      />
    ));
    setExplicitRecords([...AA_FIXTURE_RECORDS, replacementFrontierRecord]);
    expect(explicitStates[explicitStates.length - 1]?.selectedIds).toEqual(["gpt-5.6-sol"]);
    explicit.dispose();
  });

  it("keeps an explicitly cleared URL selection empty instead of restoring curated defaults", () => {
    const states: Parameters<NonNullable<Parameters<typeof AaChartSection>[0]["onStateChange"]>>[0][] = [];
    const { container, dispose } = mount(() => (
      <AaChartSection
        records={() => AA_FIXTURE_RECORDS}
        initialState={{ selectedIds: [], selectionSpecified: true }}
        onStateChange={(state) => states.push(state)}
      />
    ));
    expect(states[states.length - 1]?.selectedIds).toEqual([]);
    expect(container.querySelector("[data-testid='aa-no-points']")).not.toBeNull();
    dispose();
  });

  it("preserves an explicit URL/session selection instead of replacing it", () => {
    const states: Parameters<NonNullable<Parameters<typeof AaChartSection>[0]["onStateChange"]>>[0][] =
      [];
    const { container, dispose } = mount(() => (
      <AaChartSection
        records={() => AA_FIXTURE_RECORDS}
        initialState={{ selectedIds: ["gpt-5.6-sol"] }}
        onStateChange={(state) => states.push(state)}
      />
    ));

    expect(states[states.length - 1]?.selectedIds).toEqual(["gpt-5.6-sol"]);
    expect(container.querySelector("[data-testid='aa-filter-count']")).toBeNull();
    const selected = [...container.querySelectorAll("[data-testid='model-list'] input[type='checkbox']")]
      .filter((input) => (input as HTMLInputElement).checked);
    expect(selected).toHaveLength(1);
    expect((selected[0] as HTMLInputElement).ariaLabel).toBe("Show GPT-5.6 Sol");
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
