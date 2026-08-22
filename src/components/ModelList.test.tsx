import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import type { JSX } from "solid-js";
import ModelList from "./ModelList";
import type { PlottablePoint } from "../charts/types";

const VARIANT_POINTS: readonly PlottablePoint[] = [
  { id: "opus-low", label: "Opus 5 Low", brand: "anthropic", x: 1, y: 70 },
  { id: "opus-medium", label: "Opus 5 Medium", brand: "anthropic", x: 2, y: 71 },
  { id: "opus-high", label: "Opus 5 High", brand: "anthropic", x: 3, y: 72 },
  { id: "gpt", label: "GPT-5", brand: "openai", x: 4, y: 73 },
];

const BASE_WITH_VARIANT_POINTS: readonly PlottablePoint[] = [
  { id: "opus", label: "Opus 5", brand: "anthropic", effortGroup: "opus-5", x: 1, y: 70 },
  { id: "opus-low", label: "Opus 5 Low", brand: "anthropic", effortGroup: "opus-5", effort: "low", x: 2, y: 71 },
];

function mount(ui: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(ui, container);
  return { container, dispose: () => { dispose(); container.remove(); } };
}

describe("ModelList effort selection", () => {
  it("keeps a non-reasoning base separate from a single effort variant", () => {
    const { container, dispose } = mount(() => (
      <ModelList
        points={() => BASE_WITH_VARIANT_POINTS}
        selectedIds={() => []}
        onToggleSelect={() => undefined}
        unplottable={() => []}
        searchId="model-test-search-base"
      />
    ));

    expect(container.querySelectorAll("[data-testid='model-list'] input[type='checkbox']")).toHaveLength(2);
    expect(container.querySelector("[aria-label='Show Opus 5']")).not.toBeNull();
    expect(container.querySelector("[aria-label='Show Opus 5 Low']")).not.toBeNull();
    dispose();
  });

  it("defaults to combined family rows and toggles every effort variant together", () => {
    const [selected, setSelected] = createSignal<string[]>([]);
    const { container, dispose } = mount(() => (
      <ModelList
        points={() => VARIANT_POINTS}
        selectedIds={selected}
        onToggleSelect={(id) => setSelected((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id])}
        unplottable={() => []}
        searchId="model-test-search"
      />
    ));

    expect(container.querySelector("[data-testid='model-effort-mode'] [role='switch']")?.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector("[aria-label='Show Opus 5']")).not.toBeNull();
    expect(container.querySelectorAll("[data-testid='model-list'] input[type='checkbox']")).toHaveLength(2);

    (container.querySelector("[aria-label='Show Opus 5']") as HTMLInputElement).click();
    expect(selected()).toEqual(["opus-low", "opus-medium", "opus-high"]);
    expect((container.querySelector("[aria-label='Show Opus 5']") as HTMLInputElement).checked).toBe(true);
    dispose();
  });

  it("reveals individual rows without changing explicit selections and searches by variant label", () => {
    const [selected, setSelected] = createSignal<string[]>(["opus-medium"]);
    const { container, dispose } = mount(() => (
      <ModelList
        points={() => VARIANT_POINTS}
        selectedIds={selected}
        onToggleSelect={(id) => setSelected((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id])}
        unplottable={() => []}
        searchId="model-test-search-2"
      />
    ));

    const mode = container.querySelector("[data-testid='model-effort-mode'] [role='switch']") as HTMLButtonElement;
    const familyCheckbox = container.querySelector("[aria-label='Show Opus 5']") as HTMLInputElement;
    expect(familyCheckbox.indeterminate).toBe(true);
    expect(familyCheckbox.getAttribute("aria-checked")).toBe("mixed");
    expect((container.querySelector("[data-testid='model-list'] .badge") as HTMLElement).textContent).toBe("2");
    mode.click();
    expect((container.querySelector("[data-testid='model-list'] .badge") as HTMLElement).textContent).toBe("4");
    expect(container.querySelector("[aria-label='Show Opus 5']")).toBeNull();
    expect(container.querySelector("[aria-label='Show Opus 5 Medium']")).not.toBeNull();
    expect((container.querySelector("[aria-label='Show Opus 5 Medium']") as HTMLInputElement).checked).toBe(true);
    expect(selected()).toEqual(["opus-medium"]);

    const search = container.querySelector("#model-test-search-2") as HTMLInputElement;
    search.value = "high";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(container.querySelector("[aria-label='Show Opus 5 High']")).not.toBeNull();
    expect(container.querySelector("[aria-label='Show Opus 5 Low']")).toBeNull();
    dispose();
  });

  it("places a visible color dot before every model label", () => {
    const { container, dispose } = mount(() => (
      <ModelList
        points={() => VARIANT_POINTS}
        selectedIds={() => []}
        onToggleSelect={() => undefined}
        unplottable={() => [{ id: "missing", label: "Missing Model" }]}
        unplottableLabel={() => "no OpenRouter price"}
        unplottableDescription={() => "Switch to AA listed pricing to use the source-listed rate."}
        searchId="model-test-search-3"
      />
    ));
    const menu = container.querySelector("[data-testid='model-list'] [role='group']") as HTMLElement;
    expect(menu.className).toContain("flex-nowrap");
    expect(menu.className).toContain("overflow-y-auto");
    expect(container.textContent).toContain("Switch to AA listed pricing");
    expect(container.textContent).toContain("no OpenRouter price");
    const familyLabel = container.querySelector("[title='Opus 5']") as HTMLElement;
    expect(familyLabel.previousElementSibling?.getAttribute("aria-hidden")).toBe("true");
    const missingLabel = container.querySelector("[title='Missing Model']") as HTMLElement;
    expect(missingLabel.previousElementSibling?.getAttribute("aria-hidden")).toBe("true");
    dispose();
  });
});
