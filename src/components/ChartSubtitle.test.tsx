import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import ChartSubtitleContent, { chartSubtitlePlainText } from "./ChartSubtitle";

function mount(ui: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(ui, container);
  return { container, dispose: () => { dispose(); container.remove(); } };
}

describe("ChartSubtitleContent", () => {
  it("keeps plain text while rendering safe external links", () => {
    const content = [
      { label: "Artificial Analysis", href: "https://artificialanalysis.ai/" },
      " and ",
      { label: "OpenRouter", href: "https://openrouter.ai/" },
    ] as const;
    const { container, dispose } = mount(() => <ChartSubtitleContent content={content} />);

    expect(container.textContent).toBe("Artificial Analysis and OpenRouter");
    const links = [...container.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links).toHaveLength(2);
    links.forEach((link) => {
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener noreferrer");
    });
    expect(chartSubtitlePlainText(content)).toBe("Artificial Analysis and OpenRouter");
    dispose();
  });

  it("renders a string subtitle unchanged", () => {
    const { container, dispose } = mount(() => <ChartSubtitleContent content="Plain subtitle" />);
    expect(container.textContent).toBe("Plain subtitle");
    expect(container.querySelector("a")).toBeNull();
    dispose();
  });
});
