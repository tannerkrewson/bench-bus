import { describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import CursorBenchChartSection, { cursorChartStateFromParams, cursorChartStateToParams } from "./CursorBenchChartSection";
import { CACHE_HIT_RATE_CONTROL_ID, CURSOR_BENCH_ID, SURCHARGE_CONTROL_ID } from "./adapter";
import { CURSOR_FIXTURE_RECORDS } from "../fixtures";
import type { ChartViewState } from "../types";

const CURSOR_SUBTITLE = "This is an improved version of the CursorBench graph. On Cursor Teams and Enterprise plans, third-party model requests have a $0.25 per million tokens fee, which is not reflected on the official CursorBench, but is included by default on Bench Bus. First-party Cursor models, including Grok and Composer, are exempt from the Cursor Token Rate.";

function mount(ui: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(ui, container);
  return { container, dispose: () => { dispose(); container.remove(); } };
}

describe("CursorBenchChartSection", () => {
  it("renders the fee toggle on by default with plan coverage text above the graph", () => {
    const { container, dispose } = mount(() => <CursorBenchChartSection records={() => CURSOR_FIXTURE_RECORDS} />);
    expect(container.querySelector("section[data-benchmark='cursor']")).not.toBeNull();
    expect(container.querySelector("h2")?.textContent).toBe("Best value models on Cursor");
    const subtitle = container.querySelector("[data-testid='chart-subtitle']") as HTMLElement;
    expect(subtitle.textContent).toBe(CURSOR_SUBTITLE);
    const link = subtitle.querySelector("a") as HTMLAnchorElement;
    expect(link.textContent).toBe("CursorBench");
    expect(link.href).toBe("https://cursor.com/evals");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(container.textContent).not.toContain("CursorBench score versus average benchmark workload cost per task from cursor.com/evals.");
    expect(container.querySelector("canvas")).not.toBeNull();
    expect([...container.querySelectorAll("button")].find((b) => b.textContent === "Log")?.getAttribute("aria-pressed")).toBe("true");
    const toggle = container.querySelector("[data-testid='cursor-surcharge-toggle'] input") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(container.querySelector("[data-testid='cursor-surcharge-toggle']")?.textContent).toContain("Cursor Teams and Enterprise plans pay");
    expect(container.querySelector("[data-testid='cursor-surcharge-toggle']")?.textContent).toContain("Pro, Pro Plus, and Ultra plans do not");
    expect(container.querySelector("[data-testid='chart-area']")?.compareDocumentPosition(toggle)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
    expect(container.querySelector("[data-testid='chart-controls'] input[aria-label^='Include Cursor Token Rate']")).toBeNull();
    expect(container.querySelector(`#chart-cursor-control-${CACHE_HIT_RATE_CONTROL_ID}`)).not.toBeNull();
    expect(container.querySelector("input[aria-label='Show provider discounts']")).toBeNull();
    expect(container.querySelector("[data-testid='methodology-button-cursor']")).not.toBeNull();
    expect(container.textContent).not.toContain("see the methodology below");
    dispose();
  });

  it("toggles the fee and cache-hit control visibility", () => {
    const states: ChartViewState[] = [];
    const { container, dispose } = mount(() => (
      <CursorBenchChartSection
        records={() => CURSOR_FIXTURE_RECORDS}
        onStateChange={(state) => states.push(state)}
      />
    ));
    const toggle = container.querySelector("[data-testid='cursor-surcharge-toggle'] input") as HTMLInputElement;
    toggle.click();
    expect(toggle.checked).toBe(false);
    expect(states.at(-1)?.controls[SURCHARGE_CONTROL_ID]).toBe(false);
    expect(container.querySelector(`#chart-cursor-control-${CACHE_HIT_RATE_CONTROL_ID}`)).toBeNull();
    toggle.click();
    expect(toggle.checked).toBe(true);
    expect(states.at(-1)?.controls[SURCHARGE_CONTROL_ID]).toBe(true);
    const slider = container.querySelector(`#chart-cursor-control-${CACHE_HIT_RATE_CONTROL_ID}`) as HTMLInputElement;
    expect(slider.getAttribute("aria-label")).toBe("Estimated cache hit rate");
    expect(slider.value).toBe("90");
    expect(container.textContent).toContain("Percentage of non-output prompt tokens assumed to be served from cache");
    expect(container.textContent).toContain("Higher cache reuse implies more total processed tokens");
    dispose();
  });

  it("preserves explicit selection and emits cache-hit state", () => {
    const states: ChartViewState[] = [];
    const { container, dispose } = mount(() => <CursorBenchChartSection records={() => CURSOR_FIXTURE_RECORDS} onStateChange={(state) => states.push(state)} />);
    const slider = container.querySelector(`#chart-cursor-control-${CACHE_HIT_RATE_CONTROL_ID}`) as HTMLInputElement;
    slider.value = "75";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(states.at(-1)?.controls[CACHE_HIT_RATE_CONTROL_ID]).toBe(75);
    dispose();
  });

  it("keeps chart layers synchronized through repeated slider updates", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container, dispose } = mount(() => <CursorBenchChartSection records={() => CURSOR_FIXTURE_RECORDS} />);
    const slider = container.querySelector(`#chart-cursor-control-${CACHE_HIT_RATE_CONTROL_ID}`) as HTMLInputElement;
    for (let value = 0; value <= 100; value += 1) {
      slider.value = String(value);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(consoleError).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='benchmark-scatter-plot'] canvas")).not.toBeNull();
    expect(slider.value).toBe("100");
    dispose();
    consoleError.mockRestore();
  });
});

describe("Cursor chart URL state", () => {
  it("round-trips scale, surcharge, and cache-hit state", () => {
    const state: ChartViewState = {
      scale: "linear", query: "gemini", selectedIds: ["opus-5-max"],
      controls: { [SURCHARGE_CONTROL_ID]: true, [CACHE_HIT_RATE_CONTROL_ID]: 90 },
    };
    const params = cursorChartStateToParams(state);
    expect(params.get(`chart.${CURSOR_BENCH_ID}.scale`)).toBe("linear");
    expect(params.get(`chart.${CURSOR_BENCH_ID}.c.${SURCHARGE_CONTROL_ID}`)).toBe("true");
    expect(params.get(`chart.${CURSOR_BENCH_ID}.c.${CACHE_HIT_RATE_CONTROL_ID}`)).toBe("90");
    expect(cursorChartStateFromParams(params)).toEqual(state);
  });

  it("falls back to log and the 90% slider default", () => {
    const restored = cursorChartStateFromParams(new URLSearchParams(""));
    expect(restored.scale).toBe("log");
    expect(restored.controls[SURCHARGE_CONTROL_ID]).toBe(true);
    expect(restored.controls[CACHE_HIT_RATE_CONTROL_ID]).toBe(90);
    const old = cursorChartStateFromParams(new URLSearchParams("chart.cursor.c.tokenMix=50"));
    expect(old.controls[CACHE_HIT_RATE_CONTROL_ID]).toBe(90);
  });
});
