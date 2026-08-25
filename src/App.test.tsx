import { describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import App from "./App";

describe("App", () => {
  it("renders the Bench Bus home page with demo chart sections", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <App />, container);

    // Data (index + bundle) loads asynchronously; wait for the charts.
    await vi.waitFor(() => {
      expect(container.querySelector("h1")?.textContent).toBe("Bench Bus");
      expect(container.textContent).toContain("benchmark workload cost");
      expect(container.querySelectorAll("section[data-benchmark]")).toHaveLength(2);
    });
    expect(container.querySelector("section[data-benchmark='aa'] canvas")).not.toBeNull();
    expect(container.querySelector("section[data-benchmark='cursor'] canvas")).not.toBeNull();
    expect(container.querySelectorAll("[data-testid='chart-watermark']")).toHaveLength(2);
    expect(container.querySelector("[data-testid='chart-watermark']")?.textContent).toContain("benchb.us");
    const crownLegends = container.querySelectorAll("[role='img'][aria-label^='Pareto crown']");
    expect(crownLegends).toHaveLength(2);
    crownLegends.forEach((legend) => {
      expect(legend.querySelector("[data-testid='legend-crown'].text-base-content svg")).not.toBeNull();
      expect(legend.querySelector("[data-testid='legend-crown'].text-primary")).toBeNull();
    });
    expect([...container.querySelectorAll<HTMLInputElement>("input[aria-label='Show Pareto frontier']")].every((input) => !input.checked)).toBe(true);
    expect(container.querySelector("button[aria-label^='Switch to']")).not.toBeNull();
    expect(container.querySelector("button[data-testid='random-theme']")).not.toBeNull();
    expect(container.querySelector("[data-testid='time-travel-control'] summary[data-tip*='snapshot']")).not.toBeNull();
    const navbarEnd = container.querySelector(".navbar-end")!;
    expect(navbarEnd.children[0]?.getAttribute("data-testid")).toBe("time-travel-control");
    expect(navbarEnd.children[1]?.querySelector("button[aria-label^='Switch to']")).not.toBeNull();
    expect(container.querySelector("[data-testid='time-travel-control'] label")).toBeNull();
    expect(container.textContent).not.toContain("View data as of");
    expect(container.querySelector("[data-testid='freshness-chips']")).toBeNull();
    const footer = container.querySelector("footer");
    expect(footer?.textContent).toContain("Bench Bus by");
    expect(footer?.textContent).toContain("View on GitHub");
    expect(footer?.className).toContain("mt-6");
    expect(footer?.className).toContain("py-4");
    expect(footer?.className).not.toContain("border-t");
    expect(footer?.querySelector("div")?.className).toContain("flex-col");
    expect(footer?.querySelectorAll("a")).toHaveLength(2);
    footer?.querySelectorAll("a").forEach((link) => expect(link.className).toContain("underline"));
    expect(container.querySelectorAll("details[data-methodology-panel]")).toHaveLength(1);
    expect(container.querySelector("footer a[href='https://tannerkrewson.com']")?.getAttribute("rel")).toBe(
      "noopener noreferrer",
    );

    dispose();
    container.remove();
  });

  it("keeps transient selector filters out of the URL", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", "/?chart.aa.q=legacy");
    const dispose = render(() => <App />, container);

    await vi.waitFor(() => {
      expect(container.querySelector("#chart-aa-model-search")).not.toBeNull();
    });
    expect(window.location.search).not.toContain("chart.aa.q");

    const input = container.querySelector<HTMLInputElement>("#chart-aa-model-search");
    input!.value = "opus";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(input!.value).toBe("opus"));
    expect(window.location.search).not.toContain("chart.aa.q");

    dispose();
    container.remove();
    window.history.replaceState(null, "", originalUrl);
  });

  it("supports Solid reactivity", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const [count, setCount] = createSignal(0);
    const dispose = render(() => <span>{count()}</span>, container);

    expect(container.textContent).toBe("0");
    setCount(2);
    expect(container.textContent).toBe("2");

    dispose();
    container.remove();
  });
});
