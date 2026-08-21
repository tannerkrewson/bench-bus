import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import { UnifiedLimitationsPanel } from "./MethodologyPanel";

function mount(ui: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(ui, container);
  return { container, dispose: () => { dispose(); container.remove(); } };
}

describe("UnifiedLimitationsPanel", () => {
  it("renders one collapsed, keyboard-accessible explanation area", () => {
    const { container, dispose } = mount(() => <UnifiedLimitationsPanel />);
    const details = container.querySelector("details[data-methodology-panel]") as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toContain(
      "Methodology, sources, and limitations",
    );
    expect(container.querySelectorAll("[data-testid='unified-limitations']")).toHaveLength(1);
    dispose();
  });

  it("keeps source, estimate, and data limitations in one concise area", () => {
    const { container, dispose } = mount(() => <UnifiedLimitationsPanel />);
    const text = container.textContent ?? "";
    expect(text).toContain("actual canonical benchmark token counts");
    expect(text).toContain("30-day realized averages");
    expect(text).toContain("Cache-write volume is not published");
    expect(text).toContain("cursor.com/evals");
    expect(text).toContain("third-party fee is an estimate");
    expect(text).toContain("Historical views include only snapshots");
    dispose();
  });

  it("uses source links that remain safe when opened in a new tab", () => {
    const { container, dispose } = mount(() => <UnifiedLimitationsPanel />);
    const source = container.querySelector("a[href='https://cursor.com/evals']");
    expect(source?.getAttribute("target")).toBe("_blank");
    expect(source?.getAttribute("rel")).toBe("noopener noreferrer");
    dispose();
  });
});
