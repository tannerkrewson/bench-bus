import { describe, expect, it } from "vitest";
import { AA_FIXTURE_RECORDS, aaDemoAdapter } from "./fixtures";
import { buildChartPlot, toHighlightY, toPlotSeries } from "./plotData";

const controls = { pricingMode: "cheapest", cacheHitRate: 0.9 };

describe("buildChartPlot", () => {
  it("maps fixture records to points through the adapter", () => {
    const build = buildChartPlot(AA_FIXTURE_RECORDS, aaDemoAdapter, controls, "");
    expect(build.entries).toHaveLength(3);
    const gpt = build.entries.find((e) => e.record.slug === "gpt-5.6-sol");
    expect(gpt?.point.x).toBeCloseTo((640_112_004 / 1e6) * 1.4 + (98_220_115 / 1e6) * 9.8, 6);
    expect(gpt?.point.y).toBe(74.8);
  });

  it("surfaces unplottable records instead of mispricing them", () => {
    const build = buildChartPlot(AA_FIXTURE_RECORDS, aaDemoAdapter, controls, "");
    expect(build.unplottable.map((u) => u.record.slug)).toEqual(["mystery-model"]);
  });

  it("filters by adapter search text", () => {
    const build = buildChartPlot(AA_FIXTURE_RECORDS, aaDemoAdapter, controls, "gemini");
    expect(build.entries.map((e) => e.point.id)).toEqual(["gemini-3.7-flash"]);
    expect(build.filteredOut).toBe(3);
  });
});

describe("toPlotSeries", () => {
  it("keeps all points on linear scale", () => {
    const s = toPlotSeries(
      [
        { id: "a", label: "A", x: 1, y: 10 },
        { id: "b", label: "B", x: 2, y: 20 },
      ],
      "linear",
    );
    expect(s.ids).toEqual(["a", "b"]);
    expect(s.droppedIds).toEqual([]);
  });

  it("drops non-positive x values on log scale and reports them", () => {
    const s = toPlotSeries(
      [
        { id: "a", label: "A", x: 1, y: 10 },
        { id: "zero", label: "Z", x: 0, y: 20 },
        { id: "neg", label: "N", x: -3, y: 30 },
      ],
      "log",
    );
    expect(s.ids).toEqual(["a"]);
    expect(s.droppedIds).toEqual(["zero", "neg"]);
  });
});

describe("toHighlightY", () => {
  it("nulls everything except the selected id", () => {
    const series = { ids: ["a", "b", "c"], y: [1, 2, 3] };
    expect(toHighlightY(series, "b")).toEqual([null, 2, null]);
    expect(toHighlightY(series, null)).toEqual([null, null, null]);
    expect(toHighlightY(series, "missing")).toEqual([null, null, null]);
  });
});
