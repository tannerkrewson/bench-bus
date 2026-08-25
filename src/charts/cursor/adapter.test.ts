import { describe, expect, it } from "vitest";
import type { DerivedCursorChartRecord } from "../../schemas";
import { CURSOR_FIXTURE_RECORDS } from "../fixtures";
import { buildChartPlot } from "../plotData";
import {
  CACHE_HIT_RATE_CONTROL_ID,
  CURSOR_BENCH_ID,
  SURCHARGE_CONTROL_ID,
  completionTokensForCursorRate,
  cursorBenchAdapter,
  cursorDefaultVisibleIds,
  effectiveCursorCostUsd,
  formatCursorCostUsd,
  surchargeApplies,
} from "./adapter";

const OFF = { [SURCHARGE_CONTROL_ID]: false };
const ON = { [SURCHARGE_CONTROL_ID]: true, [CACHE_HIT_RATE_CONTROL_ID]: 90 };
const cacheHitRateControls = (rate: number) => ({ [SURCHARGE_CONTROL_ID]: true, [CACHE_HIT_RATE_CONTROL_ID]: rate });
const byId = (id: string) => {
  const record = CURSOR_FIXTURE_RECORDS.find((r) => r.modelId === id);
  if (!record) throw new Error(`fixture missing: ${id}`);
  return record;
};

describe("cursorBenchAdapter identity + axes", () => {
  it("uses the cursor URL namespace and logarithmic price axis", () => {
    expect(cursorBenchAdapter.benchmarkId).toBe(CURSOR_BENCH_ID);
    expect(cursorBenchAdapter.defaultXScale).toBe("log");
  });

  it("uses the concise linked subtitle contract", () => {
    expect(cursorBenchAdapter.subtitle).toEqual([
      { label: "Cursor Evals", href: "https://cursor.com/evals" },
      " only shows linear cost, so cheap models are hard to compare. Cursor enterprise plans also charge a flat fee for third-party model use, and the graph does not include it.",
    ]);
  });

  it("hides the current Kimi, Gemini 3.6 Flash, and GLM families by default", () => {
    const records = [
      byId("composer-2"),
      { ...byId("composer-2"), modelId: "kimi-k3-max", modelName: "Kimi K3 Max" },
      { ...byId("composer-2"), modelId: "gemini-3-6-flash-high", modelName: "Gemini 3.6 Flash High" },
      { ...byId("composer-2"), modelId: "glm-5-2-high", modelName: "GLM 5.2 High" },
      { ...byId("composer-2"), modelId: "new-model", modelName: "New Model" },
    ];
    expect(cursorDefaultVisibleIds(records)).toEqual(["composer-2", "new-model"]);
  });
});

describe("effectiveCursorCostUsd (surcharge math)", () => {
  it("leaves first-party models unchanged with surcharge enabled", () => {
    expect(effectiveCursorCostUsd(byId("composer-2"), true, 90)).toBe(byId("composer-2").publishedCostUsd);
    const grok = { ...byId("composer-2"), modelId: "grok-4-6", modelName: "Grok 4.6", isThirdParty: true };
    expect(effectiveCursorCostUsd(grok, true, 90)).toBe(grok.publishedCostUsd);
  });

  it("uses published completion tokens and output-cost subtraction", () => {
    const lunaLike: DerivedCursorChartRecord = { ...byId("opus-5-max"), modelId: "gpt-5-6-luna-low", tokensPerTask: 100_000, outputTokens: 1_000, publishedCostUsd: 1 };
    expect(completionTokensForCursorRate(lunaLike)).toBe(100_000);
    const adjusted = effectiveCursorCostUsd(lunaLike, true, 90)!;
    const outputCost = 100_000 / 1e6 * 1.2;
    const blended = 0.9 * 0.02 + 0.1 * ((0.2 + 0.25) / 2);
    const hidden = (1 - outputCost) / blended * 1e6;
    expect(adjusted).toBeCloseTo(1 + (hidden + 100_000) / 1e6 * 0.25, 10);
  });

  it("does not use completion tokens alone when pricing is unavailable", () => {
    const record = { ...byId("gemini-3.7-flash"), modelId: "unknown-model" };
    expect(effectiveCursorCostUsd(record, true, 90)).toBe(record.publishedCostUsd);
    expect(surchargeApplies(record, ON)).toBe(false);
  });

  it("leaves published cost unchanged when known output cost exceeds it", () => {
    const record = { ...byId("opus-5-max"), modelId: "gpt-5-6-luna-low", tokensPerTask: 100_000, publishedCostUsd: 0.01 };
    expect(effectiveCursorCostUsd(record, true, 90)).toBe(record.publishedCostUsd);
    expect(surchargeApplies(record, ON)).toBe(false);
    expect(cursorBenchAdapter.tooltipLines(record, cursorBenchAdapter.computePoint(record, ON)!, ON).find((line) => line.label === "Cursor Token Rate")?.value).toContain("output cost may exceed published cost");
  });
});

describe("cursorBenchAdapter.computePoint + plot build", () => {
  it("plots every valid fixture model unchanged when disabled", () => {
    const build = buildChartPlot(CURSOR_FIXTURE_RECORDS, cursorBenchAdapter, OFF, "");
    expect(build.unplottable).toHaveLength(0);
    expect(build.entries).toHaveLength(CURSOR_FIXTURE_RECORDS.length);
    for (const { record, point } of build.entries) {
      expect(point.id).toBe(record.modelId);
      expect(point.y).toBe(record.score);
      expect(point.x).toBe(record.publishedCostUsd);
    }
  });

  it("moves eligible third-party costs while keeping first-party costs unchanged", () => {
    const before = buildChartPlot(CURSOR_FIXTURE_RECORDS, cursorBenchAdapter, OFF, "");
    const after = buildChartPlot(CURSOR_FIXTURE_RECORDS, cursorBenchAdapter, ON, "");
    for (const { record, point } of after.entries) {
      const old = before.entries.find((entry) => entry.point.id === point.id)!.point;
      if (!record.isThirdParty || /^(?:grok-4-6|grok-4-5|composer-2-5)(?:-|$)/.test(record.modelId)) expect(point.x).toBe(old.x);
      else expect(point.x).toBeGreaterThanOrEqual(old.x);
    }
  });

  it("recomputes plotted costs with cache-hit endpoints and exposes the 90% default", () => {
    const record = { ...byId("opus-5-max"), modelId: "gpt-5-6-luna-low", publishedCostUsd: 30 };
    const noCache = buildChartPlot([record], cursorBenchAdapter, cacheHitRateControls(0), "opus").entries[0]!.point;
    const allCache = buildChartPlot([record], cursorBenchAdapter, cacheHitRateControls(100), "opus").entries[0]!.point;
    expect(allCache.x).toBeGreaterThan(noCache.x);
    expect(cursorBenchAdapter.controlSpecs.find((spec) => spec.id === CACHE_HIT_RATE_CONTROL_ID)).toMatchObject({ label: "Estimated cache hit rate", default: 90 });
  });

  it("tooltip states cache-hit estimate and uncertainty", () => {
    const record = { ...byId("opus-5-max"), modelId: "gpt-5-6-luna-low", publishedCostUsd: 30 };
    const point = cursorBenchAdapter.computePoint(record, cacheHitRateControls(90))!;
    const lines = cursorBenchAdapter.tooltipLines(record, point, cacheHitRateControls(90));
    expect(lines.find((line) => line.label === "Estimated cache hit rate")?.value).toContain("90%");
    expect(lines.find((line) => line.label === "Total processed tokens (estimate)")).toBeDefined();
    expect(lines.find((line) => line.label === "Uncertainty at selected cache hit rate")).toBeDefined();
  });

  it("tooltip cost values agree exactly with the plotted coordinate", () => {
    const build = buildChartPlot(CURSOR_FIXTURE_RECORDS, cursorBenchAdapter, ON, "");
    for (const { record, point } of build.entries) {
      const costLine = cursorBenchAdapter.tooltipLines(record, point, ON).find((line) => line.label === "Avg cost / task")!;
      expect(costLine.value).toBe(formatCursorCostUsd(point.x));
    }
  });
});
