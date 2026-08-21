/**
 * URL-state round-trip integration test (bench-bus-0cd.14).
 *
 * Both chart namespaces (aa, cursor) and the time-travel selection
 * (history.t) must coexist in ONE location.search string and restore
 * simultaneously — this is what makes shared chart links work.
 *
 * Uses only the exported pure (de)serializers; no DOM or network.
 */
import { describe, expect, it } from "vitest";
import {
  chartStateFromParams,
  chartStateToParams,
} from "../charts/urlState";
import { AA_CONTROL_SPECS } from "../charts/aa/adapter";
import { cursorBenchAdapter, SURCHARGE_CONTROL_ID } from "../charts/cursor/adapter";
import {
  mergeTimeTravelStateIntoParams,
  timeTravelStateFromParams,
  timeTravelStateToParams,
} from "../history/urlState";
import type { ChartViewState, PricingControlSpec } from "../charts/types";

const AA_DEFAULTS = { scale: "log" as const, controls: { pricingMode: "cheapest", cacheHitRate: 0.9 } };
const CURSOR_DEFAULTS = { scale: "log" as const, controls: { [SURCHARGE_CONTROL_ID]: false } };

const AA_STATE: ChartViewState = {
  scale: "linear",
  query: "claude",
  selectedIds: ["claude-opus-5", "gpt-5-6-luna-low"],
  controls: { pricingMode: "listed", cacheHitRate: 0.5 },
};

const CURSOR_STATE: ChartViewState = {
  scale: "log",
  query: "",
  selectedIds: ["opus-5-max"],
  controls: { [SURCHARGE_CONTROL_ID]: true },
};

const TRAVEL_AS_OF = "2026-08-20T06:00:00.000Z";

function controlSpecsFor(benchmarkId: string): readonly PricingControlSpec[] {
  return benchmarkId === "aa" ? AA_CONTROL_SPECS : cursorBenchAdapter.controlSpecs;
}

describe("URL round-trip across both chart namespaces and time travel", () => {
  it("restores all three states simultaneously from one location.search string", () => {
    const params = new URLSearchParams();
    for (const [key, value] of chartStateToParams(AA_STATE, "aa")) params.set(key, value);
    for (const [key, value] of chartStateToParams(CURSOR_STATE, "cursor")) params.set(key, value);
    for (const [key, value] of timeTravelStateToParams({ selectedAsOf: TRAVEL_AS_OF })) {
      params.set(key, value);
    }

    const search = params.toString();
    // All three namespaces present in the single query string.
    expect(search).toContain("chart.aa.");
    expect(search).toContain("chart.cursor.");
    expect(search).toContain("history.t=");

    const restored = new URLSearchParams(search);
    const aa = chartStateFromParams(restored, "aa", controlSpecsFor("aa"), AA_DEFAULTS);
    const cursor = chartStateFromParams(restored, "cursor", controlSpecsFor("cursor"), CURSOR_DEFAULTS);
    const travel = timeTravelStateFromParams(restored);

    expect(aa).toEqual(AA_STATE);
    expect(cursor).toEqual(CURSOR_STATE);
    expect(travel).toEqual({ selectedAsOf: TRAVEL_AS_OF });
  });

  it("round-trips through merge helpers without cross-contamination", () => {
    const params = new URLSearchParams("utm_source=test&keep=1");
    for (const [key, value] of chartStateToParams(AA_STATE, "aa")) params.set(key, value);
    mergeTimeTravelStateIntoParams(params, { selectedAsOf: TRAVEL_AS_OF });

    // Unrelated params survive; each namespace only carries its own keys.
    expect(params.get("utm_source")).toBe("test");
    expect(params.get("keep")).toBe("1");
    const keys = [...params.keys()];
    expect(keys.some((k) => k.startsWith("chart.aa.") && k.includes("cursor"))).toBe(false);

    const restored = chartStateFromParams(params, "aa", controlSpecsFor("aa"), AA_DEFAULTS);
    expect(restored).toEqual(AA_STATE);
    expect(timeTravelStateFromParams(params)).toEqual({ selectedAsOf: TRAVEL_AS_OF });
  });

  it("falls back to defaults for garbage values instead of throwing", () => {
    const params = new URLSearchParams([
      ["chart.aa.scale", "diagonal"],
      ["chart.aa.c.cacheHitRate", "not-a-number"],
      ["chart.cursor.c.surcharge", "maybe"],
      ["history.t", "not-a-timestamp"],
    ]);
    const aa = chartStateFromParams(params, "aa", controlSpecsFor("aa"), AA_DEFAULTS);
    expect(aa.scale).toBe("log");
    expect(aa.controls.cacheHitRate).toBe(0.9);
    const cursor = chartStateFromParams(params, "cursor", controlSpecsFor("cursor"), CURSOR_DEFAULTS);
    expect(cursor.controls[SURCHARGE_CONTROL_ID]).toBe(false);
    expect(timeTravelStateFromParams(params)).toEqual({ selectedAsOf: null });
  });
});
