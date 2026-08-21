import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import AaMethodologyPanel from "./AaMethodologyPanel";
import CursorMethodologyPanel from "./CursorMethodologyPanel";

function mount(ui: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(ui, container);
  return { container, dispose: () => { dispose(); container.remove(); } };
}

describe("AaMethodologyPanel", () => {
  it("renders collapsed by default with a discoverable affordance", () => {
    const { container, dispose } = mount(() => <AaMethodologyPanel />);
    const details = container.querySelector("details[data-methodology-panel]");
    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false);
    const summary = details?.querySelector("summary");
    expect(summary?.textContent).toContain("Methodology & limitations");
    dispose();
  });

  it("expands via its summary toggle (keyboard-activatable element)", () => {
    const { container, dispose } = mount(() => <AaMethodologyPanel />);
    const details = container.querySelector("details[data-methodology-panel]") as HTMLDetailsElement;
    const summary = details.querySelector("summary") as HTMLElement;
    summary.click();
    expect(details.open).toBe(true);
    summary.click();
    expect(details.open).toBe(false);
    dispose();
  });

  it("explains canonical token counts, pricing modes, and the no-normalized-workload stance", () => {
    const { container, dispose } = mount(() => <AaMethodologyPanel />);
    const text = container.textContent ?? "";
    expect(text).toContain("actual canonical Intelligence Index benchmark workload");
    expect(text).toContain("deliberately no normalized or hypothetical workload mode");
    expect(text).toContain("input and output prices are never mixed across providers");
    dispose();
  });

  it("states that cache estimates depend on the user-selected hit rate and cache writes are omitted", () => {
    const { container, dispose } = mount(() => <AaMethodologyPanel />);
    const text = container.textContent ?? "";
    expect(text).toContain("defaulting to 90%");
    expect(text).toContain("Cache writes are unknown and omitted");
    expect(text).toContain("cache-write token counts are not published");
    dispose();
  });

  it("states that effective prices are snapshots and change over time", () => {
    const { container, dispose } = mount(() => <AaMethodologyPanel />);
    const text = container.textContent ?? "";
    expect(text).toContain("OpenRouter effective prices are observed averages");
    expect(text).toContain("snapshot of recent routing prices, not a guaranteed future price");
    dispose();
  });

  it("explains differing token counts for equivalent work using actual benchmark counts", () => {
    const { container, dispose } = mount(() => <AaMethodologyPanel />);
    const text = container.textContent ?? "";
    expect(text).toContain("Models can require different numbers of tokens to do equivalent work");
    expect(text).toContain("intentionally uses the actual benchmark token counts");
    dispose();
  });

  it("includes the general not-a-universal-measure limitation", () => {
    const { container, dispose } = mount(() => <AaMethodologyPanel />);
    expect(container.querySelector("[data-testid='general-limitation']")?.textContent).toContain(
      "not a universal measure of real-world model value",
    );
    dispose();
  });
});

describe("CursorMethodologyPanel", () => {
  it("renders collapsed by default", () => {
    const { container, dispose } = mount(() => <CursorMethodologyPanel />);
    const details = container.querySelector("details[data-methodology-panel]") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toContain("CursorBench");
    dispose();
  });

  it("documents the cursor.com/evals source and surcharge semantics", () => {
    const { container, dispose } = mount(() => <CursorMethodologyPanel />);
    const text = container.textContent ?? "";
    expect(text).toContain("single benchmark table at cursor.com/evals");
    expect(text).toContain("$0.25 per million tokens");
    expect(text).toContain("applied on top of the published cost");
    expect(text).toContain("never baked into the raw values");
    expect(text).toContain("first-party models are unaffected");
    dispose();
  });

  it("documents display rounding and single-benchmark limitations", () => {
    const { container, dispose } = mount(() => <CursorMethodologyPanel />);
    const text = container.textContent ?? "";
    expect(text).toContain("display-rounded");
    expect(text).toContain("reduces each model to a single number");
    dispose();
  });

  it("includes the general not-a-universal-measure limitation", () => {
    const { container, dispose } = mount(() => <CursorMethodologyPanel />);
    expect(container.querySelector("[data-testid='general-limitation']")?.textContent).toContain(
      "not a universal measure of real-world model value",
    );
    dispose();
  });
});
