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
  it("opens with detailed rows and closes through its controls", () => {
    const [open, setOpen] = createSignal(false);
    const { container, dispose } = mount(() => (
      <ChartDetailModal
        benchmarkId="test"
        open={open}
        title={() => open() ? "Muse Spark 1.2" : null}
        lines={() => [{ label: "Why discounted", value: "Contributor model collects your data" }]}
        onClose={() => setOpen(false)}
      />
    ));

    expect(container.querySelector("[data-testid='chart-detail-modal']")?.hasAttribute("open")).toBe(false);
    setOpen(true);
    const dialog = container.querySelector<HTMLDialogElement>("[data-testid='chart-detail-modal']")!;
    expect(dialog.hasAttribute("open") || dialog.open).toBe(true);
    expect(dialog.textContent).toContain("Muse Spark 1.2");
    expect(dialog.textContent).toContain("Contributor model collects your data");
    (dialog.querySelector("button") as HTMLButtonElement).click();
    expect(open()).toBe(false);
    dispose();
  });
});
