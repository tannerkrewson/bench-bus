import { describe, expect, it } from "vitest";
import { AA_DEFAULT_MODEL_SLUGS } from "./constants";
import { aaAdapter } from "./adapter";
import { AA_RECORD_PLOTTABLE_CHEAPEST } from "./fixtures";
import {
  TEMPORARY_OPENROUTER_SCORE_OVERRIDES,
  temporaryOpenRouterFallbackRecords,
} from "./temporaryOverrides";

describe("temporary OpenRouter score overrides", () => {
  it("keeps the only approved fallback explicit and centrally documented", () => {
    expect(TEMPORARY_OPENROUTER_SCORE_OVERRIDES).toEqual([{
      kind: "temporary-openrouter-score-override",
      openrouterId: "z-ai/glm-5.3-flash",
      displayName: "GLM 5.3 Flash",
      score: 57,
      discountedTaskCostUsd: 0.045,
    }]);
    expect(AA_DEFAULT_MODEL_SLUGS).toEqual(expect.arrayContaining([
      "glm-5-3",
      "glm-5-2",
      "kimi-k3",
      "grok-4-6",
      "mimo-v2-5",
      "z-ai/glm-5.3-flash",
    ]));
    expect(AA_DEFAULT_MODEL_SLUGS).toContain("z-ai/glm-5.3-flash");
  });

  it("uses the approved fallback only when AA has no matching row", () => {
    const records = temporaryOpenRouterFallbackRecords([], true);
    expect(records).toEqual([expect.objectContaining({
      openrouterId: "z-ai/glm-5.3-flash",
      intelligenceIndex: 57,
      discountedTaskCostUsd: 0.045,
    })]);
  });

  it("does not emit a fallback without OpenRouter availability", () => {
    expect(temporaryOpenRouterFallbackRecords([], false)).toEqual([]);
  });

  it("automatically gives precedence to a later real AA row", () => {
    const realRecord = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      slug: "glm-5-3-flash",
      name: "GLM 5.3 Flash (high)",
      shortName: "GLM 5.3 Flash (high)",
      intelligenceIndex: 63.2,
    };
    expect(temporaryOpenRouterFallbackRecords([
      {
        slug: realRecord.slug,
        name: realRecord.name,
        shortName: realRecord.shortName,
      },
    ], true)).toEqual([]);
    expect(aaAdapter.computePoint(realRecord, { pricingMode: "cheapest" })?.y).toBe(63.2);
  });
});
