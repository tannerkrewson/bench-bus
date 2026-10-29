import { describe, expect, it } from "vitest";
import snapshot from "./fixtures/2026-10-29.json";
import { derivedCursorChartRecordSchema } from "../../schemas";
import { cursorTokenRateExemption } from "../../collectors/cursor/policy";
import { modelDisplayMetadata, expandedModelName } from "../modelMetadata";
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

  it("starts with nine relevant/frontier families, not every published family", () => {
    const selected = new Set(cursorDefaultVisibleIds(records));
    const families = [...new Set(records.filter((r) => selected.has(r.modelId))
      .map((r) => modelDisplayMetadata(r.modelName, r.modelId).groupKey))];
    expect(families.sort()).toEqual([
      "composer-2-5", "deepseek-v4-1-flash-1017", "gemini-4-argon", "gpt-5-6-luna",
      "gpt-5-6-sol", "grok-4-7", "haiku-5-5", "opus-5-5", "sonnet-5-5",
    ].sort());
    expect(selected.size).toBe(33);
    // The newly added DeepSeek release must match its curated family even
    // though ID version separators differ from its dotted source label.
    expect(selected.has("deepseek-v4-1-flash-1017-high")).toBe(true);
    expect(selected.has("fable-5-1-max")).toBe(false);
    expect(selected.has("opus-5-max")).toBe(false);
    expect(expandedModelName("Haiku 5.5 High", "haiku-5-5-high")).toBe("Anthropic Claude Haiku 5.5 (high)");
  });
});
