import { describe, expect, it } from "vitest";
import type { DerivedCursorChartRecord } from "../../schemas";
import { CURSOR_FIXTURE_RECORDS } from "../fixtures";
import { buildChartPlot } from "../plotData";
import {
  CACHE_HIT_RATE_CONTROL_ID, CURSOR_BENCH_ID, SURCHARGE_CONTROL_ID,
  completionTokensForCursorRate, cursorBenchAdapter, cursorDefaultVisibleIds,
  effectiveCursorCostUsd, formatCursorCostUsd, surchargeApplies,
} from "./adapter";

const OFF = { surcharge: false };
const ON = { surcharge: true, cacheHitRate: 90 };
const sol: DerivedCursorChartRecord = {
  modelId: "gpt-5-6-sol-high", modelName: "GPT-5.6 Sol High", provider: "openai",
  isThirdParty: true, score: 59, publishedCostUsd: 10, tokensPerTask: 100_000,
};
const composer = CURSOR_FIXTURE_RECORDS[0]!;

describe("cursorBenchAdapter identity + defaults", () => {
  it("keeps the cursor namespace, log axis, and fee-on default", () => {
    expect(cursorBenchAdapter.benchmarkId).toBe(CURSOR_BENCH_ID);
    expect(cursorBenchAdapter.defaultXScale).toBe("log");
    expect(cursorBenchAdapter.subtitle).toBe("");
    expect(cursorBenchAdapter.controlSpecs.find((s) => s.id === SURCHARGE_CONTROL_ID)).toMatchObject({ default: true });
    expect(cursorBenchAdapter.controlSpecs.find((s) => s.id === CACHE_HIT_RATE_CONTROL_ID)).toMatchObject({ label: "Estimated cache hit rate", default: 90 });
  });

  it("links both benchmark results and the independent billing policy", () => {
    expect(cursorBenchAdapter.sourceLinks).toEqual([
      { label: "CursorBench", href: "https://cursor.com/evals" },
      { label: "Cursor pricing & fee policy", href: "https://cursor.com/docs/models-and-pricing#cursor-token-rate" },
    ]);
  });

  it("hides superseded releases, dominated uncurated models, and unverified discoveries", () => {
    const records = [composer, sol,
      { ...sol, modelId: "opus-5-high", modelName: "Opus 5 High" },
      { ...sol, modelId: "opus-5-5-high", modelName: "Opus 5.5 High", publishedCostUsd: 8 },
      { ...sol, modelId: "muse-wonder-high", modelName: "Muse Wonder High", score: 20 },
      { ...sol, modelId: "unknown-model", modelName: "Unknown Model", publishedCostUsd: 0.1 },
    ];
    expect(cursorDefaultVisibleIds(records)).toEqual(["composer-2", "gpt-5-6-sol-high", "opus-5-5-high"]);
  });

  it("retains verified current value-frontier models outside the curated lineup", () => {
    const cheap = { ...sol, modelId: "glm-5-3-flash-high", modelName: "GLM 5.3 Flash High", score: 30, publishedCostUsd: 0.1 };
    expect(cursorDefaultVisibleIds([composer, cheap])).toContain(cheap.modelId);
  });

  it("does not let an unpriced newer release hide an older priced model", () => {
    const priced = { ...sol, modelId: "muse-spark-1-3-high", modelName: "Muse Spark 1.3 High" };
    const unpriced = { ...priced, modelId: "muse-spark-1-4-high", modelName: "Muse Spark 1.4 High", publishedCostUsd: undefined };
    const point = cursorBenchAdapter.computePoint(priced, ON)!;
    expect(cursorDefaultVisibleIds([priced, unpriced], [point])).toEqual([priced.modelId]);
  });
});

describe("Cursor fee eligibility and math", () => {
  it.each(["composer-2-5", "grok-4-7-extra-high", "grok-4-6-high", "grok-4-5", "haiku-5-5-high", "gpt-5-6-luna-low", "gemini-3-8-flash-high", "glm-5-3-flash-high"])("keeps exempt %s unchanged and explains the exemption", (modelId) => {
    const record = { ...sol, modelId };
    expect(effectiveCursorCostUsd(record, true, 90)).toBe(record.publishedCostUsd);
    expect(surchargeApplies(record, ON)).toBe(false);
    const point = cursorBenchAdapter.computePoint(record, ON)!;
    expect(cursorBenchAdapter.tooltipLines(record, point, ON).find((l) => l.label === "Cursor Token Rate")?.value).toContain("Exempt");
    expect(cursorBenchAdapter.summaryTooltipLines!(record, point, ON).find((l) => l.label === "Cursor Token Rate")?.value).toContain("Exempt");
  });

  it("uses published completion tokens and subtracts their known cost", () => {
    const record = { ...sol, outputTokens: 1_000 };
    expect(completionTokensForCursorRate(record)).toBe(100_000);
    const hidden = (10 - 100_000 / 1e6 * 20) / (0.9 * 0.4 + 0.1 * 4.5) * 1e6;
    expect(effectiveCursorCostUsd(record, true, 90)).toBeCloseTo(10 + (hidden + 100_000) / 1e6 * 0.25, 10);
    expect(surchargeApplies(record, ON)).toBe(true);
  });

  it.each([
    { ...sol, modelId: "unknown-model" },
    { ...sol, publishedCostUsd: 0.01 },
    { ...sol, tokensPerTask: undefined },
  ])("never labels unavailable estimates as fee-inclusive prices ($modelId)", (record) => {
    expect(effectiveCursorCostUsd(record, true, 90)).toBeNull();
    expect(cursorBenchAdapter.computePoint(record, ON)).toBeNull();
    expect(effectiveCursorCostUsd(record, false, 90)).toBe(record.publishedCostUsd);
    expect(surchargeApplies(record, ON)).toBe(false);
    const rawPoint = cursorBenchAdapter.computePoint(record, OFF)!;
    expect(cursorBenchAdapter.tooltipLines(record, rawPoint, ON).find((l) => l.label === "Cursor Token Rate")?.value).toContain("Estimate unavailable; omitted");
  });
});

describe("Cursor plots and tooltips", () => {
  it("plots every valid fixture unchanged when disabled", () => {
    const build = buildChartPlot(CURSOR_FIXTURE_RECORDS, cursorBenchAdapter, OFF, "");
    expect(build.unplottable).toHaveLength(0);
    expect(build.entries).toHaveLength(CURSOR_FIXTURE_RECORDS.length);
    for (const { record, point } of build.entries) {
      expect(point.id).toBe(record.modelId);
      expect(point.y).toBe(record.score);
      expect(point.x).toBe(record.publishedCostUsd);
    }
  });

  it("moves eligible models but not exempt ones, and surfaces unavailable estimates", () => {
    const exempt = { ...sol, modelId: "haiku-5-5-high" };
    const unavailable = { ...sol, modelId: "future-model" };
    const build = buildChartPlot([composer, sol, exempt, unavailable], cursorBenchAdapter, ON, "");
    expect(build.entries.find((e) => e.point.id === sol.modelId)?.point.x).toBeGreaterThan(10);
    expect(build.entries.find((e) => e.point.id === exempt.modelId)?.point.x).toBe(10);
    expect(build.entries.find((e) => e.point.id === composer.modelId)?.point.x).toBe(composer.publishedCostUsd);
    expect(build.unplottable.map(({ record }) => record.modelId)).toEqual(["future-model"]);
  });

  it("recomputes costs across cache-hit endpoints and states uncertainty", () => {
    const noCache = cursorBenchAdapter.computePoint(sol, { ...ON, cacheHitRate: 0 })!;
    const allCache = cursorBenchAdapter.computePoint(sol, { ...ON, cacheHitRate: 100 })!;
    expect(allCache.x).toBeGreaterThan(noCache.x);
    const lines = cursorBenchAdapter.tooltipLines(sol, allCache, { ...ON, cacheHitRate: 100 });
    expect(lines.find((l) => l.label === "Estimated cache hit rate")?.value).toContain("100%");
    expect(lines.find((l) => l.label === "Total processed tokens (estimate)")).toBeDefined();
    expect(lines.find((l) => l.label === "Uncertainty at selected cache hit rate")).toBeDefined();
  });

  it("shows exactly the plotted price in summary and detailed tooltips", () => {
    const build = buildChartPlot([composer, sol], cursorBenchAdapter, ON, "");
    for (const { record, point } of build.entries) {
      for (const lines of [cursorBenchAdapter.tooltipLines(record, point, ON), cursorBenchAdapter.summaryTooltipLines!(record, point, ON)]) {
        expect(lines.find((l) => l.label === "Avg cost / task")?.value).toBe(formatCursorCostUsd(point.x));
      }
    }
  });
});
