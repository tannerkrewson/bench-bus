import { describe, expect, it } from "vitest";
import snapshot from "./fixtures/2026-10-29.json";
import { derivedCursorChartRecordSchema } from "../../schemas";
import { cursorTokenRateExemption } from "../../collectors/cursor/policy";
import { expandedModelName, modelDisplayMetadata } from "../modelMetadata";
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

  it("shows whole current families unless one other family beats them at every effort", () => {
    const selected = new Set(cursorDefaultVisibleIds(records));
    const families = [...new Set(records.filter((r) => selected.has(r.modelId))
      .map((r) => modelDisplayMetadata(r.modelName, r.modelId).groupKey))];
    expect(families.sort()).toEqual(["gpt-5-6-luna", "haiku-5-5", "opus-5-5", "sonnet-5-5"]);
    // Every effort of a shown family is shown.
    for (const record of records) {
      const family = modelDisplayMetadata(record.modelName, record.modelId).groupKey;
      if (families.includes(family)) expect(selected.has(record.modelId), record.modelId).toBe(true);
    }
    // Superseded releases stay selector-only.
    expect(selected.has("opus-5-max")).toBe(false);
    expect(selected.has("fable-5-1-max")).toBe(false);
    // Haiku 5.5 beats every Composer 2.5 effort on both score and cost.
    expect([...selected].some((id) => id.startsWith("composer-2-5"))).toBe(false);
    expect(expandedModelName("Haiku 5.5 High", "haiku-5-5-high")).toBe("Anthropic Claude Haiku 5.5 (high)");
  });
});
