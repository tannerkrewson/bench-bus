import { describe, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import ChartDetailModal from "./ChartDetailModal";

function mount(ui: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(ui, container);
  return { container, dispose: () => { dispose(); container.remove(); } };
}

describe("ChartDetailModal", () => {
  it("opens with detailed rows and has exactly one visible Close button", () => {
    const [open, setOpen] = createSignal(false);
    const { container, dispose } = mount(() => (
      <ChartDetailModal
        benchmarkId="test"
         open={open}
         title={() => open() ? "Muse Spark 1.2" : null}
         lines={() => [{ label: "Why discounted", value: "Contributor model collects your data" }]}
         openRouterUrl={() => "https://openrouter.ai/meta/muse-spark-1.2-contributor"}
         onClose={() => setOpen(false)}
      />
    ));

    expect(container.querySelector("[data-testid='chart-detail-modal']")?.hasAttribute("open")).toBe(false);
    setOpen(true);
    const dialog = container.querySelector<HTMLDialogElement>("[data-testid='chart-detail-modal']")!;
    expect(dialog.hasAttribute("open") || dialog.open).toBe(true);
    expect(dialog.textContent).toContain("Muse Spark 1.2");
    expect(dialog.textContent).toContain("Contributor model collects your data");
    const openRouterLink = dialog.querySelector<HTMLAnchorElement>("[data-testid='openrouter-link']");
    expect(openRouterLink?.textContent).toBe("View on OpenRouter");
    expect(openRouterLink?.href).toBe("https://openrouter.ai/meta/muse-spark-1.2-contributor");
    expect(openRouterLink?.target).toBe("_blank");
    expect(openRouterLink?.rel).toBe("noopener noreferrer");
    const visibleCloseButtons = [...dialog.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => !button.closest(".modal-backdrop"))
      .filter((button) => button.textContent?.trim() === "Close");
    expect(visibleCloseButtons).toHaveLength(1);
    expect(dialog.querySelector(".modal-backdrop button")).not.toBe(visibleCloseButtons[0]);
    visibleCloseButtons[0]!.click();
    expect(open()).toBe(false);
    dispose();
  });

  it("shows a muted time-varying-discount note only when one is provided", () => {
    const note =
      "Off-peak discounts change by the hour. They often end during working hours in China and on weekends.";
    const [open, setOpen] = createSignal(true);
    const { container, dispose } = mount(() => (
      <ChartDetailModal
        benchmarkId="test"
        open={open}
        title={() => "DeepSeek R1"}
        lines={() => [{ label: "Discount", value: "50% off" }]}
        discountNote={() => (open() ? note : null)}
        onClose={() => setOpen(false)}
      />
    ));
    const dialog = container.querySelector<HTMLDialogElement>("[data-testid='chart-detail-modal']")!;
    expect(dialog.open).toBe(true);
    const noteEl = dialog.querySelector("[data-testid='chart-detail-discount-note']");
    expect(noteEl?.textContent).toBe(note);
    dispose();

    // Without the prop, no note element renders at all.
    const plain = mount(() => (
      <ChartDetailModal
        benchmarkId="test"
        open={() => true}
        title={() => "GPT-5.6 Sol"}
        lines={() => [{ label: "Discount", value: "50% off" }]}
        onClose={() => {}}
      />
    ));
    expect(
      plain.container.querySelector("[data-testid='chart-detail-discount-note']"),
    ).toBeNull();
    plain.dispose();
  });

  it("closes on Escape, native dialog close, and backdrop click", () => {
    const [open, setOpen] = createSignal(true);
    const { container, dispose } = mount(() => (
      <ChartDetailModal
        benchmarkId="test"
        open={open}
        title={() => "Muse Spark 1.2"}
        lines={() => []}
        onClose={() => setOpen(false)}
      />
    ));
    const dialog = container.querySelector<HTMLDialogElement>("[data-testid='chart-detail-modal']")!;
    expect(dialog.querySelector("[data-testid='openrouter-link']")).toBeNull();

    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(open()).toBe(false);

    setOpen(true);
    if (typeof dialog.close === "function") dialog.close();
    else dialog.dispatchEvent(new Event("close"));
    expect(open()).toBe(false);

    setOpen(true);
    dialog.querySelector<HTMLButtonElement>(".modal-backdrop button")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(open()).toBe(false);
    dispose();
  });
});
