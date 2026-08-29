import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import ChartSubtitleContent, { chartSubtitlePlainText } from "./ChartSubtitle";
import ChartSources from "./ChartSources";

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

  it("extracts unique source metadata for the source navigation", () => {
    const content = [
      { label: "Artificial Analysis", href: "https://artificialanalysis.ai/" },
      " and ",
      { label: "OpenRouter", href: "https://openrouter.ai/" },
      " again from ",
      { label: "OpenRouter", href: "https://openrouter.ai/" },
    ] as const;
    const { container, dispose } = mount(() => <ChartSources benchmarkId="test" content={content} />);

    const sourceLinks = [...container.querySelectorAll<HTMLAnchorElement>("[data-testid='chart-sources'] a")];
    expect(sourceLinks.map((link) => link.textContent)).toEqual(["Artificial Analysis", "OpenRouter"]);
    expect(sourceLinks.map((link) => link.href)).toEqual([
      "https://artificialanalysis.ai/",
      "https://openrouter.ai/",
    ]);
    expect(chartSubtitlePlainText(content)).toBe(
      "Artificial Analysis and OpenRouter again from OpenRouter",
    );
    dispose();
  });

  it("does not create source navigation without source metadata", () => {
    const { container, dispose } = mount(() => (
      <ChartSources benchmarkId="plain" content="Plain subtitle" />
    ));
    expect(container.querySelector("[data-testid='chart-sources']")).toBeNull();
    dispose();
  });
});
