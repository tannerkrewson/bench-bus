import { describe, expect, it } from "vitest";
import snapshot from "./fixtures/2026-10-29.json";
import { derivedCursorChartRecordSchema } from "../../schemas";
import { cursorTokenRateExemption } from "../../collectors/cursor/policy";
import { expandedModelName } from "../modelMetadata";
import { cursorBenchAdapter, cursorDefaultVisibleIds } from "./adapter";

const records = snapshot.records.map(({ stepsPerTask: _steps, ...record }) => derivedCursorChartRecordSchema.parse(record));
const controls = { surcharge: true, cacheHitRate: 90 };

describe("2026-10-29 CursorBench coverage regression", () => {
  it("can price every currently published record with either a fee or a documented exemption", () => {
    expect(records).toHaveLength(81);
    let exempt = 0;
    for (const record of records) {
      const point = cursorBenchAdapter.computePoint(record, controls);
      expect(point, record.modelId).not.toBeNull();
      if (cursorTokenRateExemption(record.modelId)) {
        exempt++;
        expect(point!.x, record.modelId).toBe(record.publishedCostUsd);
      } else {
        expect(record.isThirdParty, record.modelId).toBe(true);
        expect(point!.x, record.modelId).toBeGreaterThan(record.publishedCostUsd!);
      }
      expect(Number.isFinite(point!.x)).toBe(true);
    }
    expect(exempt).toBe(24);
  });

  it("shows only the newest releases that are not clearly surpassed on score and cost", () => {
    const selected = cursorDefaultVisibleIds(records);
    expect([...selected].sort()).toEqual([
      "gpt-5-6-luna-low", "gpt-5-6-luna-medium",
      "haiku-5-5-extra-high", "haiku-5-5-high", "haiku-5-5-low", "haiku-5-5-max", "haiku-5-5-medium",
      "opus-5-5-extra-high", "opus-5-5-high", "opus-5-5-max", "opus-5-5-medium",
      "sonnet-5-5-extra-high",
    ]);
    // Superseded releases stay selector-only even when they are not beaten.
    expect(selected).not.toContain("opus-5-max");
    expect(selected).not.toContain("fable-5-1-max");
    // Composer 2.5 is clearly beaten by cheaper, higher-scoring Haiku 5.5 rows.
    expect(selected.some((id) => id.startsWith("composer-2-5"))).toBe(false);
    expect(expandedModelName("Haiku 5.5 High", "haiku-5-5-high")).toBe("Anthropic Claude Haiku 5.5 (high)");
  });
});
