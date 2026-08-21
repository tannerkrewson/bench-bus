import { describe, expect, it } from "vitest";
import {
  CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS,
  type DerivedCursorChartRecord,
} from "../../schemas";
import { CURSOR_FIXTURE_RECORDS } from "../fixtures";
import { buildChartPlot } from "../plotData";
import {
  CURSOR_BENCH_ID,
  SURCHARGE_CONTROL_ID,
  cursorBenchAdapter,
  effectiveCursorCostUsd,
  formatCursorCostUsd,
  surchargeApplies,
  surchargeTokenVolume,
} from "./adapter";

const OFF = { [SURCHARGE_CONTROL_ID]: false };
const ON = { [SURCHARGE_CONTROL_ID]: true };

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
});

describe("effectiveCursorCostUsd (surcharge math)", () => {
  it("returns the published cost unchanged for first-party models even with the surcharge on", () => {
    const composer = byId("composer-2");
    expect(composer.isThirdParty).toBe(false);
    expect(effectiveCursorCostUsd(composer, true)).toBe(composer.publishedCostUsd);
  });

  it("adds exactly $0.25 per million tokens to third-party models when enabled", () => {
    const opus = byId("opus-5-max");
    const base = effectiveCursorCostUsd(opus, false)!;
    const withSurcharge = effectiveCursorCostUsd(opus, true)!;
    expect(base).toBe(opus.publishedCostUsd);
    // 1,500,000 tokens/task * $0.25/M = $0.375
    expect(withSurcharge - base).toBeCloseTo(0.375, 10);
    expect(withSurcharge - base).toBe(
      (surchargeTokenVolume(opus)! / 1e6) * CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS,
    );
  });

  it("uses the aggregate tokensPerTask, not input/output splits, for the surcharge", () => {
    const opus = byId("opus-5-max");
    // tokensPerTask (1.5M) differs from inputTokens+outputTokens (1.2M+0.3M=1.5M
    // here, so use a record where they diverge).
    const record = { ...opus, tokensPerTask: 2_000_000 };
    expect(surchargeTokenVolume(record)).toBe(2_000_000);
    const delta = effectiveCursorCostUsd(record, true)! - effectiveCursorCostUsd(record, false)!;
    expect(delta).toBeCloseTo(0.5, 10);
  });

  it("falls back to inputTokens+outputTokens when tokensPerTask is absent", () => {
    const record: DerivedCursorChartRecord = {
      ...byId("opus-5-max"),
      tokensPerTask: undefined,
    };
    expect(surchargeTokenVolume(record)).toBe(1_200_000 + 300_000);
    const delta = effectiveCursorCostUsd(record, true)! - effectiveCursorCostUsd(record, false)!;
    expect(delta).toBeCloseTo(0.375, 10);
  });

  it("never applies a surcharge without any token volume (no guessing)", () => {
    const record = {
      modelId: "no-tokens",
      modelName: "No Tokens",
      provider: "openai",
      isThirdParty: true,
      score: 50,
      publishedCostUsd: 1,
    };
    expect(surchargeTokenVolume(record)).toBeNull();
    expect(effectiveCursorCostUsd(record, true)).toBe(1);
    expect(surchargeApplies(record, ON)).toBe(false);
  });

  it("returns null (unplottable) for records without a published cost — never zero or a guess", () => {
    const record = { ...byId("composer-2"), publishedCostUsd: undefined };
    expect(effectiveCursorCostUsd(record, false)).toBeNull();
    expect(effectiveCursorCostUsd(record, true)).toBeNull();
  });

  it("returns null for non-positive or non-finite costs", () => {
    expect(effectiveCursorCostUsd({ ...byId("composer-2"), publishedCostUsd: 0 }, false)).toBeNull();
    expect(effectiveCursorCostUsd({ ...byId("composer-2"), publishedCostUsd: -1 }, false)).toBeNull();
    expect(
      effectiveCursorCostUsd({ ...byId("composer-2"), publishedCostUsd: Number.NaN }, false),
    ).toBeNull();
  });
});

describe("cursorBenchAdapter.computePoint + plot build", () => {
  it("plots every valid fixture model at its exact score/cost coordinates", () => {
    const build = buildChartPlot(CURSOR_FIXTURE_RECORDS, cursorBenchAdapter, OFF, "");
    expect(build.unplottable).toHaveLength(0);
    expect(build.entries).toHaveLength(CURSOR_FIXTURE_RECORDS.length);
    for (const { record, point } of build.entries) {
      expect(point.id).toBe(record.modelId);
      expect(point.y).toBe(record.score);
      expect(point.x).toBe(record.publishedCostUsd);
    }
  });

  it("moves only third-party models when the surcharge toggle is on", () => {
    const before = buildChartPlot(CURSOR_FIXTURE_RECORDS, cursorBenchAdapter, OFF, "");
    const after = buildChartPlot(CURSOR_FIXTURE_RECORDS, cursorBenchAdapter, ON, "");
    for (const { record, point } of after.entries) {
      const old = before.entries.find((e) => e.point.id === point.id)!.point;
      if (!record.isThirdParty) {
        expect(point.x).toBe(old.x);
      } else {
        expect(point.x).toBeGreaterThan(old.x);
      }
      expect(point.y).toBe(old.y);
    }
  });

  it("treats rows with missing published cost as unplottable, not mispriced", () => {
    const records = [
      ...CURSOR_FIXTURE_RECORDS,
      { ...byId("composer-2"), modelId: "broken", publishedCostUsd: undefined },
    ];
    const build = buildChartPlot(records, cursorBenchAdapter, ON, "");
    expect(build.entries.map((e) => e.point.id)).not.toContain("broken");
    expect(build.unplottable.map((u) => u.record.modelId)).toContain("broken");
  });

  it("tooltip cost values agree exactly with the plotted coordinate", () => {
    const build = buildChartPlot(CURSOR_FIXTURE_RECORDS, cursorBenchAdapter, ON, "");
    for (const { record, point } of build.entries) {
      const lines = cursorBenchAdapter.tooltipLines(record, point);
      const costLine = lines.find((l) => l.label === "Avg cost / task")!;
      expect(costLine.value).toBe(formatCursorCostUsd(point.x));
      // And the formatted value round-trips to the plotted x.
      expect(Number.parseFloat(costLine.value.replace("$", ""))).toBeCloseTo(point.x, 2);
      const scoreLine = lines.find((l) => l.label === "CursorBench score")!;
      expect(Number.parseFloat(scoreLine.value)).toBeCloseTo(point.y, 1);
    }
  });
});
