import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import MethodologyModal from "./MethodologyModal";
import { AaMethodologyContent, CursorMethodologyContent } from "./MethodologyPanel";

function mount(ui: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(ui, container);
  return { container, dispose: () => { dispose(); container.remove(); } };
}

describe("MethodologyModal", () => {
  it("opens an accessible graph-specific dialog with exactly one visible close button", () => {
    const { container, dispose } = mount(() => (
      <MethodologyModal benchmarkId="aa" title="Artificial Analysis methodology">
        <AaMethodologyContent />
      </MethodologyModal>
    ));
    const trigger = container.querySelector<HTMLButtonElement>("[data-testid='methodology-button-aa']")!;
    const dialog = container.querySelector<HTMLDialogElement>("[data-testid='chart-methodology-modal']")!;

    expect(dialog.open).toBe(false);
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    trigger.click();
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("aria-labelledby")).toBe("chart-methodology-aa-title");
    expect(dialog.textContent).toContain("Artificial Analysis methodology");
    expect(dialog.querySelectorAll<HTMLButtonElement>("button")).toHaveLength(1);
    expect(dialog.querySelector<HTMLButtonElement>("button")?.textContent).toBe("Close");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(dialog.open).toBe(false);
    trigger.click();
    (dialog.querySelector(".modal-backdrop") as HTMLElement).click();
    expect(dialog.open).toBe(false);
    dispose();
  });
});

describe("graph methodology content", () => {
  it("keeps Artificial Analysis and OpenRouter facts in their graph only", () => {
    const { container, dispose } = mount(() => <AaMethodologyContent />);
    const text = container.textContent ?? "";
    expect(text).toContain("real test runs");
    expect(text).toContain("over 30 days");
    expect(text).toContain("Cache writes are left out");
    expect(text).toContain("Cheapest mode picks one provider");
    expect(text).toContain("Price source");
    expect(text).not.toContain("CursorBench");
    dispose();
  });

  it("keeps CursorBench facts in their graph only", () => {
    const { container, dispose } = mount(() => <CursorMethodologyContent />);
    const text = container.textContent ?? "";
    expect(text).toContain("cursor.com/evals");
    expect(text).toContain("third-party multi-step agent workloads");
    expect(text).toContain("come from cache");
    expect(text).toContain("Grok 4.6, Grok 4.5, and Composer 2.5");
    expect(text).not.toContain("Price source");
    dispose();
  });

  it("spaces methodology paragraphs clearly apart", () => {
    const { container, dispose } = mount(() => (
      <MethodologyModal benchmarkId="aa" title="Artificial Analysis methodology">
        <AaMethodologyContent />
      </MethodologyModal>
    ));
    const body = container.querySelector("[data-testid='methodology-body']");
    expect(body).not.toBeNull();
    expect(body?.className).toContain("space-y-6");
    dispose();
  });

  it("uses safe new-tab source links", () => {
    const { container, dispose } = mount(() => (
      <>
        <AaMethodologyContent />
        <CursorMethodologyContent />
      </>
    ));
    const links = container.querySelectorAll<HTMLAnchorElement>("a");
    expect(links).toHaveLength(3);
    links.forEach((link) => {
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener noreferrer");
    });
    dispose();
  });
});
