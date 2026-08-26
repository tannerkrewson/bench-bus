import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import RelativeLastUpdated from "./RelativeLastUpdated";

function mount(ui: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(ui, container);
  return { container, dispose: () => { dispose(); container.remove(); } };
}

describe("RelativeLastUpdated", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes its relative wording and cleans up its interval", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00Z"));
    const { container, dispose } = mount(() => (
      <RelativeLastUpdated timestamp={() => "2026-08-24T11:59:30Z"} />
    ));

    const badge = () => container.querySelector("[data-testid='relative-last-updated']") as HTMLElement;
    expect(badge().textContent).toBe("Last updated just now");
    expect(badge().tagName).toBe("A");
    expect(badge().getAttribute("href")).toBe("https://github.com/tannerkrewson/bench-bus/deployments");
    expect(badge().getAttribute("target")).toBe("_blank");
    expect(badge().getAttribute("rel")).toBe("noopener noreferrer");
    expect(badge().getAttribute("title")).toBe("Last updated Aug 24, 2026, 11:59 AM UTC");
    expect(badge().getAttribute("aria-label")).toBe("Last updated Aug 24, 2026, 11:59 AM UTC");

    vi.advanceTimersByTime(60_000);
    expect(badge().textContent).toBe("Last updated 1 minute ago");

    dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("renders nothing for an invalid timestamp", () => {
    const { container, dispose } = mount(() => <RelativeLastUpdated timestamp={() => "invalid"} />);
    expect(container.querySelector("[data-testid='relative-last-updated']")).toBeNull();
    dispose();
  });
});
