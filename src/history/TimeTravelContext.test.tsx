import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import { TimeTravelProvider, useTimeTravel } from "./TimeTravelContext";
import type { BundleIndex } from "./types";

const T1 = "2026-08-19T03:00:00.000Z";
const T2 = "2026-08-20T03:00:00.000Z";
const T3 = "2026-08-21T03:00:00.000Z";

const INDEX: BundleIndex = {
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

/** Probe component exposing the context value on the container for assertions. */
function Probe(props: { onValue: (value: ReturnType<typeof useTimeTravel>) => void }) {
  const travel = useTimeTravel();
  props.onValue(travel);
  return null;
}

describe("TimeTravelProvider", () => {
  it("starts at latest, selects earlier times, and returns to latest", () => {
    let travel!: ReturnType<typeof useTimeTravel>;
    mount(() => (
      <TimeTravelProvider index={INDEX}>
        <Probe onValue={(v) => (travel = v)} />
      </TimeTravelProvider>
    ));

    expect(travel.view().isLatest).toBe(true);
    expect(travel.view().entry?.asOf).toBe(T3);

    travel.selectTime(T1);
    expect(travel.selectedAsOf()).toBe(T1);
    expect(travel.view().entry?.asOf).toBe(T1);
    expect(travel.view().isLatest).toBe(false);

    travel.returnToLatest();
    expect(travel.selectedAsOf()).toBeNull();
    expect(travel.view().entry?.asOf).toBe(T3);
    expect(travel.view().isLatest).toBe(true);
  });

  it("ignores selections that are not compiled times", () => {
    let travel!: ReturnType<typeof useTimeTravel>;
    mount(() => (
      <TimeTravelProvider index={INDEX}>
        <Probe onValue={(v) => (travel = v)} />
      </TimeTravelProvider>
    ));
    travel.selectTime("2026-08-20T15:30:00.000Z");
    expect(travel.selectedAsOf()).toBeNull();
    expect(travel.view().isLatest).toBe(true);
  });

  it("reports state changes for URL persistence", () => {
    const changes: string[] = [];
    let travel!: ReturnType<typeof useTimeTravel>;
    mount(() => (
      <TimeTravelProvider index={INDEX} onStateChange={(s) => changes.push(s.selectedAsOf ?? "latest")}>
        <Probe onValue={(v) => (travel = v)} />
      </TimeTravelProvider>
    ));
    travel.selectTime(T2);
    travel.returnToLatest();
    expect(changes).toEqual([T2, "latest"]);
  });

  it("restores an initial selection (e.g. from the URL) and flags pre-history", () => {
    let travel!: ReturnType<typeof useTimeTravel>;
    mount(() => (
      <TimeTravelProvider index={INDEX} initialSelectedAsOf="2026-08-01T00:00:00.000Z">
        <Probe onValue={(v) => (travel = v)} />
      </TimeTravelProvider>
    ));
    expect(travel.view().preHistory).toBe(true);
    expect(travel.view().entry).toBeNull();
    // Returning to latest recovers from a pre-history URL.
    travel.returnToLatest();
    expect(travel.view().entry?.asOf).toBe(T3);
  });
});
