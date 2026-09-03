import { describe, expect, it } from "vitest";
import type { PlottablePoint } from "./types";
import { AA_FIXTURE_RECORDS, aaDemoAdapter } from "./fixtures";
import {
  buildChartPlot,
  discountDetailLines,
  discountHoverTitle,
  discountMath,
  discountProviderSummary,
  discountSummaryLines,
  discountForPoint,
  validDiscountAnnotation,
  modelLabelParts,
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
  it("formats AA-relative savings rounded to whole percent with an accessible label", () => {
    expect(modelLabelWithDiscount("Model", { percentage: 43.1, preDiscountX: 10 })).toBe("Model (43% discount)");
    expect(modelLabelWithDiscount("Model", { percentage: 43.5, preDiscountX: 10 })).toBe("Model (44% discount)");
    expect(modelLabelWithDiscount("Model", { percentage: 100, preDiscountX: 10, effectiveX: 0 })).toBe("Model (100% discount)");
    expect(modelLabelWithDiscount("Model", null)).toBe("Model");
    expect(modelLabelParts("Model", { percentage: 43.1, preDiscountX: 10 })).toEqual({
      mainLabel: "Model",
      discountLabel: "(43% discount)",
      accessibleLabel: "Model (43% discount)",
    });
  });
});

describe("discount presentation", () => {
  it("keeps hover savings copy simple and names the cheapest provider", () => {
    const point: PlottablePoint = { id: "muse", label: "Muse Spark 1.2", x: 4, y: 70 };
    const discount = {
      percentage: 43.4,
      preDiscountX: 7,
      effectiveX: 4,
      providerName: "OpenRouter",
    };
    expect(discountSummaryLines({ x: point.x }, discount)).toEqual([
      { label: "Savings vs AA listed", value: "$7.00 * (1 - 43.4%) = $4.00" },
      { label: "Cheapest provider", value: "OpenRouter" },
    ]);
    expect(discountHoverTitle(point, discount)).toBe("Muse Spark 1.2 (43% discount)");
    expect(discountMath(point, discount)).toBe("$7.00 * (1 - 43.4%) = $4.00");
    expect(discountDetailLines(point, discount).map((line) => line.label)).toEqual([
      "Savings vs AA listed",
      "Cheapest provider",
      "AA listed cost",
      "OpenRouter cost",
    ]);
  });

  it("uses the cheapest provider as the only provider identity", () => {
    const discount = {
      percentage: 50,
      preDiscountX: 10,
      effectiveX: 5,
      providerName: "Winning Provider",
    };
    expect(discountProviderSummary(discount)).toBe("Winning Provider");
    expect(discountHoverTitle({ label: "Model", x: 6 }, discount)).toContain("Model (50% discount)");
  });
});

describe("validDiscountAnnotation", () => {
  it("retains a valid 100% annotation with a zero effective cost", () => {
    const discount = { percentage: 100, preDiscountX: 10, effectiveX: 0 };
    expect(validDiscountAnnotation(discount)).toEqual(discount);
    expect(validDiscountAnnotation({ ...discount, percentage: 101 })).toBeNull();
    expect(validDiscountAnnotation({ ...discount, percentage: 99 })).toBeNull();
  });

  it("rejects a percentage that disagrees with its raw/effective costs", () => {
    expect(validDiscountAnnotation({ percentage: 40, preDiscountX: 10, effectiveX: 5 })).toBeNull();
    expect(validDiscountAnnotation({ percentage: 50, preDiscountX: 10, effectiveX: 5.001 })).toEqual({
      percentage: 50,
      preDiscountX: 10,
      effectiveX: 5.001,
    });
  });
});

describe("discountForPoint", () => {
  it("accepts only valid positive AA-relative savings", () => {
    const point = {
      id: "discounted", label: "Discounted", x: 6, y: 70,
      discount: { percentage: 40, preDiscountX: 10, effectiveX: 6, providerName: "Provider A" },
    };
    expect(discountForPoint(point)).toEqual(point.discount);
    expect(discountForPoint({
      ...point,
      discount: { percentage: 100, preDiscountX: 10, effectiveX: 0 },
    })).toEqual({ percentage: 100, preDiscountX: 10, effectiveX: 0 });
    expect(discountForPoint({ ...point, discount: { percentage: 0, preDiscountX: 10 } })).toBeNull();
    expect(discountForPoint({ ...point, discount: { percentage: 40, preDiscountX: -1 } })).toBeNull();
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
