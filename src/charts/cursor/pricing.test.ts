import { describe, expect, it } from "vitest";
import type { DerivedCursorChartRecord } from "../../schemas";
import {
  blendCursorNonOutputPrice,
  cursorCompletionTokens,
  cursorNonOutputPrices,
  cursorTokenRateProfile,
  estimateCursorTokenRate,
} from "./pricing";

const luna: DerivedCursorChartRecord = {
  modelId: "gpt-5-6-luna-low",
  modelName: "GPT-5.6 Luna Low",
  provider: "openai",
  isThirdParty: true,
  score: 70,
  tokensPerTask: 100_000,
  publishedCostUsd: 1,
};

const composer: DerivedCursorChartRecord = {
  ...luna,
  modelId: "composer-2-5",
  modelName: "Composer 2.5",
  provider: "cursor",
  isThirdParty: false,
};

const fable: DerivedCursorChartRecord = {
  ...luna,
  modelId: "fable-5-max",
  modelName: "Fable 5 Max",
  provider: "unknown",
  tokensPerTask: 103_525,
  publishedCostUsd: 17.32,
};

describe("Cursor token-rate pricing", () => {
  it("matches Fable 5 variants to the published Cursor rate card", () => {
    const profile = cursorTokenRateProfile(fable)!;
    expect(profile).toEqual({
      inputPriceUsdPerMillion: 10,
      cacheReadPriceUsdPerMillion: 1,
      cacheWritePriceUsdPerMillion: 12.5,
      outputPriceUsdPerMillion: 50,
    });
    const estimate = estimateCursorTokenRate(fable, 50);
    expect(estimate).not.toBeNull();
    expect(estimate?.completionTokens).toBe(103_525);
    expect(estimate?.outputCostUsd).toBeCloseTo(5.17625, 8);
    expect(estimate?.adjustedCostUsd).toBeGreaterThan(fable.publishedCostUsd!);
  });

  it("uses cache-read, input, and cache-write rates for Luna endpoints", () => {
    const profile = cursorTokenRateProfile(luna)!;
    expect(cursorNonOutputPrices(profile)).toEqual([0.2, 0.02, 0.25]);
    expect(blendCursorNonOutputPrice(profile, 0)).toBe(0.02);
    expect(blendCursorNonOutputPrice(profile, 100)).toBe(0.25);
    expect(blendCursorNonOutputPrice(profile, 50)).toBeCloseTo(Math.sqrt(0.02 * 0.25), 12);
  });

  it("subtracts known completion cost before estimating hidden and total tokens", () => {
    const estimate = estimateCursorTokenRate(luna, 50)!;
    const outputCost = (100_000 / 1e6) * 1.2;
    const hidden = ((1 - outputCost) / Math.sqrt(0.02 * 0.25)) * 1e6;
    expect(estimate.completionTokens).toBe(100_000);
    expect(estimate.outputCostUsd).toBeCloseTo(outputCost, 12);
    expect(estimate.residualNonOutputCostUsd).toBeCloseTo(1 - outputCost, 12);
    expect(estimate.hiddenTokens).toBeCloseTo(hidden, 6);
    expect(estimate.totalTokens).toBeCloseTo(hidden + 100_000, 6);
    expect(estimate.adjustedCostUsd).toBeGreaterThan(1);
  });

  it("has cache-heavy, midpoint, and input/write-heavy uncertainty endpoints", () => {
    const cacheHeavy = estimateCursorTokenRate(luna, 0)!;
    const neutral = estimateCursorTokenRate(luna, 50)!;
    const inputWriteHeavy = estimateCursorTokenRate(luna, 100)!;
    expect(cacheHeavy.blendedNonOutputPriceUsdPerMillion).toBe(0.02);
    expect(inputWriteHeavy.blendedNonOutputPriceUsdPerMillion).toBe(0.25);
    expect(neutral.blendedNonOutputPriceUsdPerMillion).toBeCloseTo(Math.sqrt(0.02 * 0.25), 12);
    expect(inputWriteHeavy.totalTokens).toBeLessThan(neutral.totalTokens);
    expect(neutral.totalTokens).toBeLessThan(cacheHeavy.totalTokens);
    expect(inputWriteHeavy.adjustedCostUsd).toBeLessThan(cacheHeavy.adjustedCostUsd);
    expect(cacheHeavy.surchargeRangeUsd[0]).toBeCloseTo(inputWriteHeavy.surchargeUsd, 12);
    expect(cacheHeavy.surchargeRangeUsd[1]).toBeCloseTo(cacheHeavy.surchargeUsd, 12);
  });

  it("uses tokensPerTask as completion tokens, never as total tokens", () => {
    const record = { ...luna, tokensPerTask: 200_000, outputTokens: 1_000 };
    expect(cursorCompletionTokens(record)).toBe(200_000);
    const estimate = estimateCursorTokenRate(record, 50)!;
    expect(estimate.completionTokens).toBe(200_000);
    expect(estimate.totalTokens).toBeGreaterThan(estimate.completionTokens);
  });

  it("exempts first-party Cursor models", () => {
    expect(estimateCursorTokenRate(composer, 50)).toBeNull();
  });

  it("fails closed for missing completion tokens, rates, and invalid slider values", () => {
    expect(estimateCursorTokenRate({ ...luna, tokensPerTask: undefined }, 50)).toBeNull();
    expect(estimateCursorTokenRate({ ...luna, outputTokens: undefined, tokensPerTask: undefined }, 50)).toBeNull();
    expect(estimateCursorTokenRate({ ...luna, publishedCostUsd: -1 }, 50)).toBeNull();
    expect(blendCursorNonOutputPrice(cursorTokenRateProfile(luna)!, -1)).toBeNull();
    expect(blendCursorNonOutputPrice(cursorTokenRateProfile(luna)!, 101)).toBeNull();
  });

  it("returns unavailable when known output cost exceeds published cost", () => {
    const estimate = estimateCursorTokenRate({ ...luna, publishedCostUsd: 0.01 }, 50);
    expect(estimate).toBeNull();
  });
});
