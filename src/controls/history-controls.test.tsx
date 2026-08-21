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
  it("lists latest plus every compiled time and enables return-to-latest only when away", () => {
    const { container, dispose } = mount(() => (
      <TimeTravelProvider index={INDEX}>
        <TimeTravelControl />
      </TimeTravelProvider>
    ));

    const select = container.querySelector("#time-travel-select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    // "Latest data" + 3 compiled times, newest first after the latest option.
    const options = [...select.options].map((o) => o.value);
    expect(options).toEqual(["", T3, T2, T1]);
    expect(select.value).toBe(""); // latest

    const back = container.querySelector("button") as HTMLButtonElement;
    expect(back.disabled).toBe(true); // already latest

    // Move to an earlier time via the control.
    select.value = T1;
    select.dispatchEvent(new Event("change"));
    expect(select.value).toBe(T1);
    expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(false);
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
    const back = container.querySelector("button") as HTMLButtonElement;
    expect(back.disabled).toBe(false);
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
