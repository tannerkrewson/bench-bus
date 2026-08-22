import { describe, expect, it } from "vitest";
import { AA_FIXTURE_RECORDS, aaDemoAdapter } from "./fixtures";
import {
  buildChartPlot,
  explicitDiscountForAnnotation,
  explicitDiscountForPoint,
  modelLabelWithDiscount,
  paretoFrontier,
  selectCrownPoints,
  toPlotSeries,
} from "./plotData";

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
  });
});

describe("modelLabelWithDiscount", () => {
  it("appends discount percentage directly without creating a standalone label", () => {
    expect(modelLabelWithDiscount("Model", { percentage: 43.1, preDiscountX: 10 })).toBe("Model 43.1% off");
    expect(modelLabelWithDiscount("Model", { percentage: 100, preDiscountX: 10, effectiveX: 0 })).toBe("Model 100% off");
    expect(modelLabelWithDiscount("Model", null)).toBe("Model");
  });
});

describe("explicitDiscountForAnnotation", () => {
  it("retains a valid 100% source annotation with a zero effective cost", () => {
    const discount = { percentage: 100, preDiscountX: 10, effectiveX: 0 };
    expect(explicitDiscountForAnnotation(discount)).toEqual(discount);
    expect(explicitDiscountForAnnotation({ ...discount, percentage: 101 })).toBeNull();
    expect(explicitDiscountForAnnotation({ ...discount, percentage: 99 })).toBeNull();
  });
});

describe("explicitDiscountForPoint", () => {
  it("accepts only explicit positive percentage discounts", () => {
    const point = {
      id: "discounted", label: "Discounted", x: 6, y: 70,
      discount: { percentage: 40, preDiscountX: 10, providerName: "Provider A" },
    };
    expect(explicitDiscountForPoint(point)).toEqual(point.discount);
    expect(explicitDiscountForPoint({
      ...point,
      discount: { percentage: 100, preDiscountX: 10, effectiveX: 0 },
    })).toEqual({ percentage: 100, preDiscountX: 10, effectiveX: 0 });
    expect(explicitDiscountForPoint({ ...point, discount: { percentage: 0, preDiscountX: 10 } })).toBeNull();
    expect(explicitDiscountForPoint({ ...point, discount: { percentage: 40, preDiscountX: -1 } })).toBeNull();
  });

  it("selects only the largest explicit percentage", () => {
    const point = {
      id: "multi", label: "Multi", x: 6, y: 70,
      discounts: [
        { percentage: 25, preDiscountX: 8, providerName: "Provider A" },
        { percentage: 40, preDiscountX: 10, providerName: "Provider B" },
      ],
    };
    expect(explicitDiscountForPoint(point)?.providerName).toBe("Provider B");
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

describe("selectCrownPoints", () => {
  it("keeps only the top crown when nearby crowns overlap", () => {
    expect(selectCrownPoints(
      [{ id: "top", left: 100, top: 100 }, { id: "lower", left: 100, top: 115 }],
      [{ id: "top", left: 100, top: 100 }, { id: "lower", left: 100, top: 115 }],
    ).map((point) => point.id)).toEqual(["top"]);
  });

  it("drops a lower crown that would cover an intervening dot", () => {
    expect(selectCrownPoints(
      [{ id: "top", left: 100, top: 90 }, { id: "lower", left: 100, top: 120 }],
      [{ id: "top", left: 100, top: 90 }, { id: "intervening", left: 100, top: 100 }, { id: "lower", left: 100, top: 120 }],
    ).map((point) => point.id)).toEqual(["top"]);
  });
});

describe("paretoFrontier", () => {
  it("keeps increasing-score frontier points and removes dominated points", () => {
    const frontier = paretoFrontier([
      { id: "cheap-low", label: "Cheap low", x: 1, y: 40 },
      { id: "cheap-high", label: "Cheap high", x: 1, y: 45 },
      { id: "middle", label: "Middle", x: 2, y: 44 },
      { id: "better", label: "Better", x: 3, y: 60 },
      { id: "dominated", label: "Dominated", x: 4, y: 55 },
    ]);
    expect(frontier.map((point) => point.id)).toEqual(["cheap-high", "better"]);
  });

  it("does not include equal-score points at a higher cost", () => {
    const frontier = paretoFrontier([
      { id: "first", label: "First", x: 1, y: 50 },
      { id: "same-score", label: "Same score", x: 2, y: 50 },
    ]);
    expect(frontier.map((point) => point.id)).toEqual(["first"]);
  });
});
