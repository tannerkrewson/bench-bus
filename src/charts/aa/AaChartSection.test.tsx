import { describe, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import AaChartSection from "./AaChartSection";
import { AA_FIXTURE_RECORDS, AA_RECORD_PLOTTABLE_CHEAPEST, AA_RECORD_UNPLOTTABLE } from "./fixtures";
import { chartStateFromParams, chartStateToParams } from "../urlState";
import { aaAdapter } from "./adapter";
import { AA_DEFAULT_COST_MODE, AA_DEFAULT_MODEL_SLUGS } from "./constants";

const AA_SUBTITLE = "This chart compares AA listed prices with the cheapest effective OpenRouter provider for the real benchmark workload, updated multiple times per day as prices change";

function mount(ui: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(ui, container);
  return { container, dispose: () => { dispose(); container.remove(); } };
}

describe("AaChartSection", () => {
  it("renders the AA chart with pricing controls and disabled unplottable models", () => {
    const { container, dispose } = mount(() => (
      <AaChartSection records={() => AA_FIXTURE_RECORDS} />
    ));

    expect(container.querySelector("section[data-benchmark='aa']")).not.toBeNull();
    const title = container.querySelector("h2#chart-title-aa") as HTMLHeadingElement;
    const titleLink = title?.querySelector("a[data-testid='chart-title-link']") as HTMLAnchorElement;
    expect(title?.textContent).toBe("Best value models on OpenRouter");
    expect(titleLink?.getAttribute("href")).toBe("#chart-title-aa");
    expect(titleLink?.textContent).toBe("Best value models on OpenRouter");
    const subtitle = container.querySelector("[data-testid='chart-subtitle']") as HTMLElement;
    expect(subtitle.textContent).toBe(AA_SUBTITLE);
    expect(subtitle.classList.contains("whitespace-pre-line")).toBe(true);
    const links = [...subtitle.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links).toHaveLength(0);
    links.forEach((link) => {
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener noreferrer");
    });
    expect(container.textContent).not.toContain("Intelligence Index score versus estimated benchmark workload cost per task.");
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(
      container.querySelector("input#chart-aa-control-pricingMode, #chart-aa-control-pricingMode"),
    ).not.toBeNull();
    const scoreSource = container.querySelector("#chart-aa-control-scoreSource") as HTMLSelectElement;
    expect(scoreSource).not.toBeNull();
    expect([...scoreSource.options].map((option) => option.textContent)).toEqual([
      "Artificial Analysis",
      "DeepSWE pass@1",
    ]);
    // 3 plotted + 1 unplottable (no providers) in the default mode.
    const checkboxes = container.querySelectorAll("[data-testid='model-list'] input[type='checkbox']");
    expect(checkboxes).toHaveLength(3);
    expect(container.textContent).toContain("Mystery Model");
    expect(container.textContent).toContain("no pricing");
    expect(container.textContent).toContain("Unavailable with the current pricing settings.");
    expect(container.querySelector("[data-testid='model-list'] .cursor-not-allowed")).not.toBeNull();
    expect(container.querySelector("[data-testid='methodology-button-aa']")).not.toBeNull();
    expect(container.querySelector("[data-testid='chart-methodology-modal']")).not.toBeNull();
    expect(container.querySelector("[data-testid='aa-unplottable-count']")).toBeNull();

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

  it("uses listed pricing and selects scored records when DeepSWE is selected", () => {
    const { container, dispose } = mount(() => <AaChartSection records={() => AA_FIXTURE_RECORDS} />);
    const scoreSource = container.querySelector("#chart-aa-control-scoreSource") as HTMLSelectElement;
    scoreSource.value = "deepswe";
    scoreSource.dispatchEvent(new Event("change", { bubbles: true }));

    const pricingMode = container.querySelector("#chart-aa-control-pricingMode") as HTMLSelectElement;
    expect(pricingMode.value).toBe("listed");
    expect(container.querySelector("#chart-aa-control-cacheHitRate")).not.toBeNull();
    expect(container.textContent).not.toContain("no DeepSWE score");
    expect(container.querySelectorAll("[data-testid='model-list'] input[type='checkbox']")).toHaveLength(1);
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
    expect(badge.textContent).toContain("Last updated");
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

  it("emphasizes the model family when its AA-baseline endpoint is hovered", async () => {
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
      listed: { price1mInputTokens: 80, price1mOutputTokens: 104.93, cacheHitPrice: 80 },
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
    expect(container.querySelector("[data-testid='chart-tooltip']")).toBeNull();
    expect(container.querySelector("[data-testid='hovered-dot']")).toBeNull();
    expect(container.querySelector("[data-hovered-label-id='gpt-5.6-sol-high']")).not.toBeNull();
    expect(container.querySelectorAll("[data-testid='discount-line-connector']")).toHaveLength(1);
    dispose();
  });

  it("uses the provider-qualified model name in the detail modal", async () => {
    const discounted = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      slug: "claude-opus-5",
      name: "Claude Opus 5",
      shortName: "Opus 5",
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
      listed: { price1mInputTokens: 80, price1mOutputTokens: 104.93, cacheHitPrice: 80 },
    };
    const { container, dispose } = mount(() => (
      <AaChartSection
        records={() => [discounted]}
        initialState={{ selectedIds: [discounted.slug], selectionSpecified: true }}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const endpoint = container.querySelector<HTMLElement>("[data-testid='discount-endpoint-hit']");
    endpoint?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const dialog = container.querySelector<HTMLDialogElement>("[data-testid='chart-detail-modal']")!;
    expect(dialog.querySelector("h3")?.textContent).toBe("Anthropic Claude Opus 5");
    dispose();
  });

  it("flags hour-varying off-peak discounts for DeepSeek-like models in the detail modal", async () => {
    const deepSeek = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      slug: "deepseek-r1-0528",
      name: "DeepSeek R1 0528",
      shortName: "DeepSeek R1",
      canonicalTokens: { input: 1_000_000, output: 1_000_000 },
      providers: [{
        providerName: "DeepSeek (fp8)",
        providerSlug: "deepseek-fp8",
        effectiveInputPrice: 40,
        effectiveOutputPrice: 52.465,
        listedInputPrice: 80,
        listedOutputPrice: 104.93,
        discountPercentage: 50,
      }],
      listed: { price1mInputTokens: 80, price1mOutputTokens: 104.93, cacheHitPrice: 80 },
    };
    const { container, dispose } = mount(() => (
      <AaChartSection
        records={() => [deepSeek]}
        initialState={{ selectedIds: [deepSeek.slug], selectionSpecified: true }}
      />
    ));

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const endpoint = container.querySelector<HTMLElement>("[data-testid='discount-endpoint-hit']");
    expect(endpoint).not.toBeNull();
    endpoint?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const dialog = container.querySelector<HTMLDialogElement>("[data-testid='chart-detail-modal']")!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector("[data-testid='chart-detail-discount-note']")?.textContent).toBe(
      "Effective provider prices change by the hour. Off-peak rates often end during working hours in China and on weekends.",
    );
    dispose();
  });

  it("does not flag unaffected models with the time-varying-discount note", async () => {
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
      listed: { price1mInputTokens: 80, price1mOutputTokens: 104.93, cacheHitPrice: 80 },
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
    endpoint?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const dialog = container.querySelector<HTMLDialogElement>("[data-testid='chart-detail-modal']")!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain("Savings vs AA listed");
    expect(dialog.querySelector("[data-testid='chart-detail-discount-note']")).toBeNull();
    dispose();
  });

  it("opens the AA methodology from the chart header", () => {
    const { container, dispose } = mount(() => <AaChartSection records={() => AA_FIXTURE_RECORDS} />);
    const trigger = container.querySelector<HTMLButtonElement>("[data-testid='methodology-button-aa']")!;
    const dialog = container.querySelector<HTMLDialogElement>("[data-testid='chart-methodology-modal']")!;
    trigger.click();
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain("Price source");
    expect(dialog.textContent).not.toContain("cursor.com/evals");
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

  it("plots listed pricing after switching from the default OpenRouter mode", async () => {
    const listedOnly = {
      ...AA_RECORD_UNPLOTTABLE,
      slug: "listed-only",
      name: "Listed Only",
      listed: { price1mInputTokens: 2, price1mOutputTokens: 8, cacheHitPrice: 0.2 },
    };
    const { container, dispose } = mount(() => (
      <AaChartSection
        records={() => [listedOnly]}
        initialState={{ selectedIds: [listedOnly.slug], selectionSpecified: true }}
      />
    ));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelector("[data-testid='aa-unplottable-count']")).toBeNull();
    const pricingMode = container.querySelector("#chart-aa-control-pricingMode") as HTMLSelectElement;
    pricingMode.value = "listed";
    pricingMode.dispatchEvent(new Event("change", { bubbles: true }));
    expect(container.querySelector("[data-testid='aa-unplottable-count']")).toBeNull();
    expect(container.querySelector("canvas")).not.toBeNull();
    dispose();
  });

  it("selects the requested curated defaults and keeps missing upstream models harmless", () => {
    const states: Parameters<NonNullable<Parameters<typeof AaChartSection>[0]["onStateChange"]>>[0][] =
      [];
    const { container, dispose } = mount(() => (
      <AaChartSection records={() => AA_FIXTURE_RECORDS} onStateChange={(state) => states.push(state)} />
    ));

    expect(states[states.length - 1]?.selectedIds).toEqual(expect.arrayContaining([
      ...AA_DEFAULT_MODEL_SLUGS,
    ]));
    expect(AA_DEFAULT_MODEL_SLUGS).toEqual(expect.arrayContaining([
      "gpt-5-6-luna-low",
      "gpt-5-6-luna-medium",
      "gpt-5-6-luna-high",
      "gpt-5-6-luna-xhigh",
      "gpt-5-6-luna",
      "gpt-5-6-sol-low",
      "gpt-5-6-sol-medium",
      "gpt-5-6-sol-high",
      "gpt-5-6-sol-xhigh",
      "gpt-5-6-sol",
      "mimo-v2-5-0424",
    ]));
    expect(AA_DEFAULT_MODEL_SLUGS).not.toContain("gpt-5-6-luna-non-reasoning");
    expect(AA_DEFAULT_MODEL_SLUGS).not.toContain("mistral-medium-3-5");
    expect(AA_DEFAULT_MODEL_SLUGS).toContain("deepseek-v4-flash");
    expect(AA_DEFAULT_MODEL_SLUGS).toContain("glm-5-3-flash");
    expect(container.querySelector("[data-testid='aa-no-points']")).toBeNull();
    expect(AA_DEFAULT_COST_MODE).toBe("intelligence-vs-cost-per-task");
    dispose();
  });

  it("does not automatically show uncurated newly discovered models", () => {
    const astra = {
      ...AA_RECORD_UNPLOTTABLE,
      slug: "gpt-6-astra",
      name: "GPT-6 Astra (max)",
      shortName: "GPT-6 Astra (max)",
      intelligenceIndex: 61,
      providers: [{ providerName: "OpenAI", providerSlug: "openai", effectiveInputPrice: 1, effectiveOutputPrice: 5 }],
      listed: { price1mInputTokens: 10, price1mOutputTokens: 50, cacheHitPrice: 1 },
    };
    const astraLow = {
      ...AA_RECORD_UNPLOTTABLE,
      slug: "gpt-6-astra-low",
      name: "GPT-6 Astra (low)",
      shortName: "GPT-6 Astra (low)",
      intelligenceIndex: 56.7,
      listed: { price1mInputTokens: 10, price1mOutputTokens: 50, cacheHitPrice: 1 },
    };
    const astraHigh = {
      ...astraLow,
      slug: "gpt-6-astra-high",
      name: "GPT-6 Astra (high)",
      shortName: "GPT-6 Astra (high)",
      intelligenceIndex: 60.3,
    };
    const anthropic = {
      ...astraLow,
      slug: "claude-new-model",
      name: "Claude New Model",
      shortName: "Claude New Model",
      intelligenceIndex: 55,
    };
    const gemini = {
      ...astraLow,
      slug: "gemini-new-model",
      name: "Gemini New Model",
      shortName: "Gemini New Model",
      intelligenceIndex: 54,
    };
    const unrelated = {
      ...astraLow,
      slug: "unrelated-model",
      name: "Unrelated Model",
      shortName: "Unrelated Model",
      intelligenceIndex: 1,
      listed: { price1mInputTokens: 100, price1mOutputTokens: 100, cacheHitPrice: 10 },
    };
    const states: Parameters<NonNullable<Parameters<typeof AaChartSection>[0]["onStateChange"]>>[0][] = [];
    const { dispose } = mount(() => (
      <AaChartSection
        records={() => [astra, astraLow, astraHigh, anthropic, gemini, unrelated]}
        onStateChange={(state) => states.push(state)}
      />
    ));

    const selected = states[states.length - 1]?.selectedIds ?? [];
    expect(selected).toContain("gpt-6-astra");
    expect(selected).not.toContain("gpt-6-astra-low");
    expect(selected).not.toContain("gpt-6-astra-high");
    expect(selected).not.toContain("claude-new-model");
    expect(selected).not.toContain("gemini-new-model");
    expect(selected).not.toContain("unrelated-model");
    dispose();
  });

  it("removes superseded model releases from the implicit defaults", () => {
    const oldRelease = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      slug: "glm-5-2",
      name: "GLM-5.2 (max)",
      shortName: "GLM-5.2 (max)",
    };
    const newRelease = {
      ...oldRelease,
      slug: "glm-5-3",
      name: "GLM-5.3 (max)",
      shortName: "GLM-5.3 (max)",
    };
    const states: Parameters<NonNullable<Parameters<typeof AaChartSection>[0]["onStateChange"]>>[0][] = [];
    const { dispose } = mount(() => (
      <AaChartSection records={() => [oldRelease, newRelease]} onStateChange={(state) => states.push(state)} />
    ));
    const selected = states[states.length - 1]?.selectedIds ?? [];
    expect(selected).toContain("glm-5-3");
    expect(selected).not.toContain("glm-5-2");
    dispose();
  });

  it("does not let an unpriced newer release hide an older priced default", () => {
    const priced = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      slug: "muse-spark-1-3-xhigh",
      name: "Muse Spark 1.3 (xhigh)",
      shortName: "Muse Spark 1.3 (xhigh)",
    };
    const unpriced = {
      ...priced,
      slug: "muse-spark-1-4-xhigh",
      name: "Muse Spark 1.4 (xhigh)",
      shortName: "Muse Spark 1.4 (xhigh)",
      providers: [],
      weighted: { weightedInputPrice: 0, weightedOutputPrice: 0, },
      listed: { price1mInputTokens: 0, price1mOutputTokens: 0, cacheHitPrice: 0 },
    };
    const states: Parameters<NonNullable<Parameters<typeof AaChartSection>[0]["onStateChange"]>>[0][] = [];
    const { dispose } = mount(() => (
      <AaChartSection records={() => [priced, unpriced]} onStateChange={(state) => states.push(state)} />
    ));
    const selected = states[states.length - 1]?.selectedIds ?? [];
    expect(selected).toContain("muse-spark-1-3-xhigh");
    expect(selected).not.toContain("muse-spark-1-4-xhigh");
    dispose();
  });

  it("keeps all Luna and Sol reasoning variants while excluding non-reasoning rows", () => {
    const variants = [
      ["gpt-5-6-luna-low", "GPT-5.6 Luna (low)"],
      ["gpt-5-6-luna-medium", "GPT-5.6 Luna (medium)"],
      ["gpt-5-6-luna-high", "GPT-5.6 Luna (high)"],
      ["gpt-5-6-luna-xhigh", "GPT-5.6 Luna (xhigh)"],
      ["gpt-5-6-luna", "GPT-5.6 Luna (max)"],
      ["gpt-5-6-sol-low", "GPT-5.6 Sol (low)"],
      ["gpt-5-6-sol-medium", "GPT-5.6 Sol (medium)"],
      ["gpt-5-6-sol-high", "GPT-5.6 Sol (high)"],
      ["gpt-5-6-sol-xhigh", "GPT-5.6 Sol (xhigh)"],
      ["gpt-5-6-sol", "GPT-5.6 Sol (max)"],
    ] as const;
    const records = variants.map(([slug, name]) => ({
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      slug,
      name,
      shortName: name,
    }));
    const nonReasoning = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      slug: "gpt-5-6-luna-non-reasoning",
      name: "GPT-5.6 Luna (Non-reasoning)",
      shortName: "GPT-5.6 Luna (Non-reasoning)",
    };
    const states: Parameters<NonNullable<Parameters<typeof AaChartSection>[0]["onStateChange"]>>[0][] = [];
    const { dispose } = mount(() => (
      <AaChartSection
        records={() => [...records, nonReasoning]}
        onStateChange={(state) => states.push(state)}
      />
    ));
    const selected = states[states.length - 1]?.selectedIds ?? [];
    expect(selected).toEqual(expect.arrayContaining(variants.map(([slug]) => slug)));
    expect(selected).not.toContain("gpt-5-6-luna-non-reasoning");
    dispose();
  });

  it("keeps uncurated frontier discoveries selector-only and preserves explicit selections", () => {
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
    expect(states[states.length - 1]?.selectedIds).not.toContain("frontier-not-curated");
    expect(AA_DEFAULT_MODEL_SLUGS).not.toContain("frontier-not-curated");
    setRecords([...AA_FIXTURE_RECORDS, replacementFrontierRecord]);
    expect(states[states.length - 1]?.selectedIds).not.toContain("frontier-from-new-snapshot");
    expect(states[states.length - 1]?.selectedIds).not.toContain("frontier-not-curated");
    const frontierCheckbox = container.querySelector(
      "input[aria-label='Show Frontier From New Snapshot']",
    ) as HTMLInputElement;
    frontierCheckbox.click();
    expect(states[states.length - 1]?.selectedIds).toContain("frontier-from-new-snapshot");
    const reset = [...container.querySelectorAll("[data-testid='model-list'] button")].find(
      (button) => button.textContent === "Reset to default",
    );
    reset?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(states[states.length - 1]?.selectedIds).not.toContain("frontier-from-new-snapshot");
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
