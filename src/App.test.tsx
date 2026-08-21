import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import App from "./App";

describe("App", () => {
  it("renders the Bench Bus home page with demo chart sections", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <App />, container);

    expect(container.querySelector("h1")?.textContent).toBe("Bench Bus");
    expect(container.textContent).toContain("benchmark workload cost");
    // Both demo benchmark sections mounted with uPlot canvases.
    expect(container.querySelectorAll("section[data-benchmark]")).toHaveLength(2);
    expect(container.querySelector("section[data-benchmark='aa-demo'] canvas")).not.toBeNull();
    expect(container.querySelector("section[data-benchmark='cursor-demo'] canvas")).not.toBeNull();

    dispose();
    container.remove();
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
