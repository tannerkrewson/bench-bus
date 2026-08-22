import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import TimeTravelControl from "./TimeTravelControl";
import FreshnessChips from "./FreshnessChips";
import { TimeTravelProvider } from "../history/TimeTravelContext";
import type { SourceFreshness } from "../history/types";

const T1 = "2026-08-19T03:00:00.000Z";
const T2 = "2026-08-20T03:00:00.000Z";
const T3 = "2026-08-21T03:00:00.000Z";

const INDEX = {
  v: 1,
  entries: [
    { asOf: T1, path: "1.json", aa: true, cursor: true },
    { asOf: T2, path: "2.json", aa: true, cursor: true },
    { asOf: T3, path: "3.json", aa: true, cursor: true },
  ],
};

function mount(ui: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(ui, container);
  return { container, dispose: () => { dispose(); container.remove(); } };
}

describe("TimeTravelControl", () => {
  it("opens an icon history picker with latest plus every compiled time", () => {
    const { container, dispose } = mount(() => (
      <TimeTravelProvider index={INDEX}>
        <TimeTravelControl />
      </TimeTravelProvider>
    ));

    const trigger = container.querySelector("summary") as HTMLElement;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute("aria-label")).toContain("history");
    expect(trigger.getAttribute("data-tip")).toContain("snapshot");
    trigger.click();

    const menu = container.querySelector("[data-testid='time-travel-menu']") as HTMLElement;
    expect(menu).not.toBeNull();
    const items = [...menu.querySelectorAll<HTMLButtonElement>("[role='menuitem']")];
    // Latest plus 3 compiled times, newest first.
    expect(items.map((item) => item.textContent?.trim())).toHaveLength(4);
    expect(items[0]?.textContent).toContain("Latest data");

    // Move to an earlier time via the history menu.
    items.at(-1)?.click();
    expect(container.querySelector("[role='menuitem'].btn-active")?.textContent).toContain("Aug");
    expect(menu.querySelector("button.btn-ghost")?.textContent).toContain("Return to latest");
    dispose();
  });

  it("shows a pre-history notice when the selection predates collected history", () => {
    const { container, dispose } = mount(() => (
      <TimeTravelProvider index={INDEX} initialSelectedAsOf="2026-08-01T00:00:00.000Z">
        <TimeTravelControl />
      </TimeTravelProvider>
    ));
    const notice = container.querySelector("[role='status']");
    expect(notice?.textContent).toContain("predates");
    const trigger = container.querySelector("summary") as HTMLElement;
    trigger.click();
    expect(container.querySelector("[data-testid='time-travel-menu'] button.btn-ghost")?.textContent)
      .toContain("Return to latest");
    dispose();
  });
});

describe("FreshnessChips", () => {
  const NOW = "2026-08-21T06:23:00.000Z";

  it("renders per-source freshness with transparent staleness wording", () => {
    const freshness: SourceFreshness[] = [
      { source: "aa", available: true, observedAt: "2026-08-21T05:00:00.000Z" },
      { source: "openrouter", available: true, observedAt: "2026-08-21T01:23:00.000Z" }, // missed crons
      { source: "cursor", available: true, observedAt: "2026-08-20T23:00:00.000Z" },
    ];
    const { container, dispose } = mount(() => <FreshnessChips freshness={freshness} now={NOW} />);

    const or = container.querySelector("[data-testid='freshness-openrouter']");
    expect(or?.textContent).toContain("OpenRouter pricing");
    expect(or?.textContent).toContain("as of Aug 21, 01:23 UTC");
    expect(or?.textContent).toContain("last sampled 5h ago");
    // Staleness is status information, not an error.
    expect(container.querySelector("[role='alert']")).toBeNull();
    dispose();
  });

  it("says explicitly when a source had no data at the viewed time", () => {
    const freshness: SourceFreshness[] = [
      { source: "aa", available: false },
      { source: "openrouter", available: true, observedAt: "2026-08-21T06:00:00.000Z" },
      { source: "cursor", available: false },
    ];
    const { container, dispose } = mount(() => <FreshnessChips freshness={freshness} now={NOW} />);
    expect(container.querySelector("[data-testid='freshness-aa']")?.textContent).toContain(
      "no data at this time",
    );
    expect(
      container.querySelector("[data-testid='freshness-aa']")?.getAttribute("data-available"),
    ).toBe("false");
    expect(container.querySelector("[data-testid='freshness-openrouter']")?.textContent).toContain(
      "23m ago",
    );
    dispose();
  });
});
