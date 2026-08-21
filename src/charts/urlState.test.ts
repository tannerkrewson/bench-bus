import { describe, expect, it } from "vitest";
import {
  chartStateFromParams,
  chartStateToParams,
  chartStateToQueryString,
  mergeChartStateIntoParams,
} from "./urlState";
import type { PricingControlSpec } from "./types";

const specs: readonly PricingControlSpec[] = [
  { kind: "toggle", id: "surcharge", label: "Surcharge", default: false },
  { kind: "slider", id: "cacheHitRate", label: "Cache hit", min: 0, max: 1, step: 0.01, default: 0.9 },
  {
    kind: "select",
    id: "mode",
    label: "Mode",
    default: "cheapest",
    options: [
      { value: "cheapest", label: "Cheapest" },
      { value: "weighted", label: "Weighted" },
    ],
  },
];

const defaults = {
  scale: "log" as const,
  controls: { surcharge: false, cacheHitRate: 0.9, mode: "cheapest" },
};

describe("chart URL state", () => {
  it("round-trips full state", () => {
    const state = {
      scale: "linear" as const,
      query: "opus",
      selectedIds: ["a", "b"],
      controls: { surcharge: true, cacheHitRate: 0.5, mode: "weighted" },
    };
    const parsed = chartStateFromParams(
      chartStateToParams(state, "aa-demo"),
      "aa-demo",
      specs,
      defaults,
    );
    expect(parsed).toEqual(state);
  });

  it("round-trips the optional label visibility setting", () => {
    const state = {
      scale: "log" as const,
      query: "",
      selectedIds: [],
      controls: {},
      showLabels: false,
    };
    const params = chartStateToParams(state, "aa-demo");
    expect(params.get("chart.aa-demo.labels")).toBe("false");
    expect(
      chartStateFromParams(params, "aa-demo", specs, defaults).showLabels,
    ).toBe(false);
  });

  it("round-trips Pareto frontier visibility", () => {
    const state = {
      scale: "log" as const,
      query: "",
      selectedIds: [],
      controls: {},
      showFrontier: false,
    };
    const params = chartStateToParams(state, "aa-demo");
    expect(params.get("chart.aa-demo.frontier")).toBe("false");
    expect(chartStateFromParams(params, "aa-demo", specs, defaults).showFrontier).toBe(false);
  });

  it("namespaces per benchmark so two charts coexist", () => {
    const params = chartStateToParams(
      { scale: "linear", query: "", selectedIds: [], controls: { mode: "weighted" } },
      "cursor-demo",
    );
    expect(params.get("chart.cursor-demo.scale")).toBe("linear");
    expect(params.get("chart.aa-demo.scale")).toBeNull();
  });

  it("omits an unspecified empty selection but preserves an explicit empty selection", () => {
    const qs = chartStateToQueryString(
      { scale: "log", query: "", selectedIds: [], controls: {} },
      "aa-demo",
    );
    expect(qs).toBe("chart.aa-demo.scale=log");
    const cleared = chartStateToQueryString(
      { scale: "log", query: "", selectedIds: [], selectionSpecified: true, controls: {} },
      "aa-demo",
    );
    expect(cleared).toBe("chart.aa-demo.scale=log&chart.aa-demo.sel=");
    expect(
      chartStateFromParams(new URLSearchParams(cleared), "aa-demo", specs, defaults).selectionSpecified,
    ).toBe(true);
  });

  it("falls back to defaults on missing or invalid values", () => {
    const params = new URLSearchParams(
      "chart.aa-demo.scale=diagonal" +
        "&chart.aa-demo.c.cacheHitRate=42" +
        "&chart.aa-demo.mode=secret" +
        "&chart.aa-demo.surcharge=maybe" +
        "&chart.cursor-demo.scale=linear",
    );
    const parsed = chartStateFromParams(params, "aa-demo", specs, defaults);
    expect(parsed.scale).toBe("log");
    expect(parsed.controls.cacheHitRate).toBe(0.9);
    expect(parsed.controls.mode).toBe("cheapest");
    expect(parsed.controls.surcharge).toBe(false);
    // The other benchmark's keys are ignored entirely.
    expect(chartStateFromParams(params, "cursor-demo", specs, defaults).scale).toBe("linear");
  });

  it("parses slider bounds inclusively and clamps nothing silently", () => {
    const ok = new URLSearchParams("chart.aa-demo.c.cacheHitRate=0");
    expect(chartStateFromParams(ok, "aa-demo", specs, defaults).controls.cacheHitRate).toBe(0);
    const tooBig = new URLSearchParams("chart.aa-demo.c.cacheHitRate=1.5");
    expect(chartStateFromParams(tooBig, "aa-demo", specs, defaults).controls.cacheHitRate).toBe(0.9);
  });

  it("merges into an existing params object without clobbering foreign keys", () => {
    const target = new URLSearchParams("foo=bar");
    mergeChartStateIntoParams(
      target,
      { scale: "linear", query: "x", selectedIds: ["m1"], controls: { surcharge: true } },
      "aa-demo",
    );
    expect(target.get("foo")).toBe("bar");
    expect(target.get("chart.aa-demo.sel")).toBe("m1");
  });
});
