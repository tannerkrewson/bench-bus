import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
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

  it("updates when the timestamp accessor changes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T22:30:00Z"));
    const [timestamp, setTimestamp] = createSignal("2026-08-21T00:00:00Z");
    const { container, dispose } = mount(() => <RelativeLastUpdated timestamp={timestamp} />);

    const badge = () => container.querySelector("[data-testid='relative-last-updated']") as HTMLElement;
    expect(badge().getAttribute("aria-label")).toBe("Last updated Aug 21, 2026, 12:00 AM UTC");

    setTimestamp("2026-09-01T22:28:06.896Z");
    expect(badge().getAttribute("aria-label")).toBe("Last updated Sep 1, 2026, 10:28 PM UTC");

    dispose();
  });
});
