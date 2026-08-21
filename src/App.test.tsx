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
    expect(container.querySelector("button[aria-label^='Switch to']")).not.toBeNull();
    expect(container.querySelector("button[data-testid='random-theme']")).not.toBeNull();
    expect(container.querySelector("[data-testid='freshness-chips']")).toBeNull();
    const footer = container.querySelector("footer");
    expect(footer?.getAttribute("aria-label")).toBe("Site information");
    expect(footer?.textContent).toContain("Bench Bus by");
    expect(footer?.textContent).toContain("View on GitHub");
    expect(footer?.className).toContain("mt-6");
    expect(footer?.className).toContain("py-4");
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
