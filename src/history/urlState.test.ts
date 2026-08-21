import { describe, expect, it } from "vitest";
import {
  mergeTimeTravelStateIntoParams,
  timeTravelStateFromParams,
  timeTravelStateToParams,
} from "./urlState";

const T = "2026-08-20T03:00:00.000Z";

describe("time travel URL state", () => {
  it("round-trips a selected historical time", () => {
    const params = timeTravelStateToParams({ selectedAsOf: T });
    expect(params.get("history.t")).toBe(T);
    expect(timeTravelStateFromParams(params)).toEqual({ selectedAsOf: T });
  });

  it("omits the key entirely for latest (default) state", () => {
    const params = timeTravelStateToParams({ selectedAsOf: null });
    expect([...params.keys()]).toEqual([]);
    expect(timeTravelStateFromParams(params)).toEqual({ selectedAsOf: null });
  });

  it("falls back forgivingly to latest for missing, empty, or invalid values", () => {
    expect(timeTravelStateFromParams(new URLSearchParams())).toEqual({ selectedAsOf: null });
    expect(timeTravelStateFromParams(new URLSearchParams("history.t="))).toEqual({
      selectedAsOf: null,
    });
    expect(timeTravelStateFromParams(new URLSearchParams("history.t=yesterday"))).toEqual({
      selectedAsOf: null,
    });
    expect(timeTravelStateFromParams(new URLSearchParams("history.t=2026-08-20 03:00"))).toEqual({
      selectedAsOf: null,
    });
  });

  it("merges into existing params without disturbing other keys", () => {
    const target = new URLSearchParams("chart.aa.scale=log");
    mergeTimeTravelStateIntoParams(target, { selectedAsOf: T });
    expect(target.get("chart.aa.scale")).toBe("log");
    expect(target.get("history.t")).toBe(T);
  });

  it("merging latest state clears the selection without disturbing other keys", () => {
    const target = new URLSearchParams("chart.aa.scale=log&history.t=2020-01-01T00:00:00.000Z");
    mergeTimeTravelStateIntoParams(target, { selectedAsOf: null });
    expect(target.get("history.t")).toBeNull();
    expect(target.get("chart.aa.scale")).toBe("log");
  });
});
