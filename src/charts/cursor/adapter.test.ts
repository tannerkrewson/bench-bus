import { describe, expect, it } from "vitest";
import type { DerivedCursorChartRecord } from "../../schemas";
import { CURSOR_FIXTURE_RECORDS } from "../fixtures";
import { buildChartPlot } from "../plotData";
import {
  CURSOR_BENCH_ID,
  SURCHARGE_CONTROL_ID,
  TOKEN_MIX_CONTROL_ID,
  completionTokensForCursorRate,
  cursorBenchAdapter,
  cursorDefaultVisibleIds,
  effectiveCursorCostUsd,
  formatCursorCostUsd,
  surchargeApplies,
} from "./adapter";

const OFF = { [SURCHARGE_CONTROL_ID]: false };
const ON = { [SURCHARGE_CONTROL_ID]: true, [TOKEN_MIX_CONTROL_ID]: 50 };
const tokenMixControls = (tokenMix: number) => ({
  [SURCHARGE_CONTROL_ID]: true,
  [TOKEN_MIX_CONTROL_ID]: tokenMix,
});

const byId = (id: string) => {
  const record = CURSOR_FIXTURE_RECORDS.find((r) => r.modelId === id);
  if (!record) throw new Error(`fixture missing: ${id}`);
  return record;
};

describe("cursorBenchAdapter identity + axes", () => {
  it("uses the cursor URL namespace and defaults to a logarithmic price axis", () => {
    expect(cursorBenchAdapter.benchmarkId).toBe(CURSOR_BENCH_ID);
    expect(cursorBenchAdapter.defaultXScale).toBe("log");
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
  it("leaves first-party models unchanged with the surcharge enabled", () => {
    const composer = byId("composer-2");
    expect(effectiveCursorCostUsd(composer, true)).toBe(composer.publishedCostUsd);
  });

  it("uses published tokensPerTask as completion tokens with output-cost subtraction", () => {
    const lunaLike: DerivedCursorChartRecord = {
      ...byId("opus-5-max"),
      modelId: "gpt-5-6-luna-low",
      tokensPerTask: 100_000,
      outputTokens: 1_000,
      publishedCostUsd: 1,
    };
    expect(completionTokensForCursorRate(lunaLike)).toBe(100_000);
    const adjusted = effectiveCursorCostUsd(lunaLike, true, 50)!;
    const outputCost = 100_000 / 1e6 * 1.2;
    const hidden = (1 - outputCost) / Math.sqrt(0.02 * 0.25) * 1e6;
    expect(adjusted).toBeCloseTo(1 + (hidden + 100_000) / 1e6 * 0.25, 10);
  });

  it("does not use completion tokens alone when model pricing is unavailable", () => {
    const record = { ...byId("gemini-3.7-flash"), modelId: "unknown-model" };
    expect(effectiveCursorCostUsd(record, true, 50)).toBe(record.publishedCostUsd);
    expect(surchargeApplies(record, ON)).toBe(false);
  });

  it("leaves published cost unchanged when known output cost exceeds it", () => {
    const record = {
      ...byId("opus-5-max"),
      modelId: "gpt-5-6-luna-low",
      tokensPerTask: 100_000,
      publishedCostUsd: 0.01,
    };
    expect(effectiveCursorCostUsd(record, true, 50)).toBe(record.publishedCostUsd);
    expect(surchargeApplies(record, ON)).toBe(false);
    const point = cursorBenchAdapter.computePoint(record, ON)!;
    const lines = cursorBenchAdapter.tooltipLines(record, point, ON);
    const unavailable = lines.find((line) => line.label === "Cursor Token Rate");
    expect(unavailable?.value).toContain("output cost may exceed published cost");
  });

  it("leaves rows without published cost unplottable", () => {
    const record = { ...byId("composer-2"), publishedCostUsd: undefined };
    expect(effectiveCursorCostUsd(record, false)).toBeNull();
    expect(effectiveCursorCostUsd(record, true)).toBeNull();
  });
});

describe("cursorBenchAdapter.computePoint + plot build", () => {
  it("plots every valid fixture model at exact score/cost when disabled", () => {
    const build = buildChartPlot(CURSOR_FIXTURE_RECORDS, cursorBenchAdapter, OFF, "");
    expect(build.unplottable).toHaveLength(0);
    expect(build.entries).toHaveLength(CURSOR_FIXTURE_RECORDS.length);
    for (const { record, point } of build.entries) {
      expect(point.id).toBe(record.modelId);
      expect(point.y).toBe(record.score);
      expect(point.x).toBe(record.publishedCostUsd);
    }
  });

  it("moves rate-backed third-party models but keeps first-party costs unchanged", () => {
    const before = buildChartPlot(CURSOR_FIXTURE_RECORDS, cursorBenchAdapter, OFF, "");
    const after = buildChartPlot(CURSOR_FIXTURE_RECORDS, cursorBenchAdapter, ON, "");
    for (const { record, point } of after.entries) {
      const old = before.entries.find((e) => e.point.id === point.id)!.point;
      if (!record.isThirdParty) expect(point.x).toBe(old.x);
      else expect(point.x).toBeGreaterThanOrEqual(old.x);
      expect(point.y).toBe(old.y);
    }
  });

  it("recomputes plotted costs with cache-heavy and input/write-heavy assumptions", () => {
    const record = { ...byId("opus-5-max"), modelId: "gpt-5-6-luna-low", publishedCostUsd: 30 };
    const cacheHeavy = buildChartPlot([record], cursorBenchAdapter, tokenMixControls(0), "opus").entries[0]!.point;
    const inputWriteHeavy = buildChartPlot([record], cursorBenchAdapter, tokenMixControls(100), "opus").entries[0]!.point;
    expect(cacheHeavy.x).toBeGreaterThan(inputWriteHeavy.x);
    expect(cursorBenchAdapter.controlSpecs.find((spec) => spec.id === TOKEN_MIX_CONTROL_ID)).toMatchObject({
      label: "Token mix assumption",
      default: 50,
    });
  });

  it("tooltip states the selected mix and estimate details", () => {
    const record = { ...byId("opus-5-max"), modelId: "gpt-5-6-luna-low", publishedCostUsd: 30 };
    const point = cursorBenchAdapter.computePoint(record, tokenMixControls(50))!;
    const lines = cursorBenchAdapter.tooltipLines(record, point, tokenMixControls(50));
    expect(lines.find((line) => line.label === "Token mix assumption")?.value).toContain("50%");
    expect(lines.find((line) => line.label === "Completion tokens")).toBeDefined();
    expect(lines.find((line) => line.label === "Total processed tokens (estimate)")).toBeDefined();
    expect(lines.find((line) => line.label === "Adjusted cost")).toBeDefined();
    expect(lines.filter((line) => line.label === "Cursor Token Rate fee")).toHaveLength(1);
  });

  it("tooltip cost values agree exactly with the plotted coordinate", () => {
    const build = buildChartPlot(CURSOR_FIXTURE_RECORDS, cursorBenchAdapter, ON, "");
    for (const { record, point } of build.entries) {
      const lines = cursorBenchAdapter.tooltipLines(record, point, ON);
      const costLine = lines.find((l) => l.label === "Avg cost / task")!;
      expect(costLine.value).toBe(formatCursorCostUsd(point.x));
    }
  });
});
