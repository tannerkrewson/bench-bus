import { describe, expect, it } from "vitest";
import type { DerivedCursorChartRecord } from "../../schemas";
import {
  blendCursorNonOutputPrice,
  cursorTokenRateProfile,
  estimateCursorTokenRate,
} from "./pricing";

const luna: DerivedCursorChartRecord = {
  modelId: "gpt-5-6-luna-low",
  modelName: "GPT-5.6 Luna Low",
  provider: "openai",
  isThirdParty: true,
  score: 70,
  outputTokens: 100_000,
  publishedCostUsd: 1,
};

const composer: DerivedCursorChartRecord = {
  ...luna,
  modelId: "composer-2-5",
  modelName: "Composer 2.5",
  provider: "cursor",
  isThirdParty: false,
};

describe("Cursor token-rate pricing", () => {
  it("uses model-specific Luna endpoints and a geometric midpoint", () => {
    const profile = cursorTokenRateProfile(luna)!;
    expect(blendCursorNonOutputPrice(profile, 0)).toBe(0.02);
    expect(blendCursorNonOutputPrice(profile, 100)).toBe(0.25);
    expect(blendCursorNonOutputPrice(profile, 50)).toBeCloseTo(Math.sqrt(0.02 * 0.25), 12);
  });

  it("subtracts known output cost before estimating hidden and total tokens", () => {
    const estimate = estimateCursorTokenRate(luna, 50)!;
    const outputCost = (100_000 / 1e6) * 1.2;
    const hidden = ((1 - outputCost) / Math.sqrt(0.02 * 0.25)) * 1e6;
    expect(estimate.outputCostUsd).toBeCloseTo(outputCost, 12);
    expect(estimate.hiddenTokens).toBeCloseTo(hidden, 6);
    expect(estimate.totalTokens).toBeCloseTo(hidden + 100_000, 6);
    expect(estimate.adjustedCostUsd).toBeGreaterThan(1);
  });

  it("exempts first-party Cursor models", () => {
    expect(estimateCursorTokenRate(composer, 50)).toBeNull();
  });

  it("fails closed for missing output, negative residual, and invalid prices", () => {
    expect(estimateCursorTokenRate({ ...luna, outputTokens: undefined }, 50)).toBeNull();
    expect(estimateCursorTokenRate({ ...luna, outputTokens: 1_000_000 }, 50)).toBeNull();
    expect(estimateCursorTokenRate({ ...luna, publishedCostUsd: -1 }, 50)).toBeNull();
    expect(blendCursorNonOutputPrice(cursorTokenRateProfile(luna)!, -1)).toBeNull();
  });
});
