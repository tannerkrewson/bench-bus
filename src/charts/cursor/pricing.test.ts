import { describe, expect, it } from "vitest";
import type { DerivedCursorChartRecord } from "../../schemas";
import {
  blendCursorNonOutputPrice,
  cursorCompletionTokens,
  cursorNonOutputPrices,
  cursorTokenRateProfile,
  estimateCursorTokenRate,
  isCursorFirstPartyModel,
} from "./pricing";

const luna: DerivedCursorChartRecord = {
  modelId: "gpt-5-6-luna-low", modelName: "GPT-5.6 Luna Low", provider: "openai",
  isThirdParty: true, score: 70, tokensPerTask: 100_000, publishedCostUsd: 1,
};
const composer: DerivedCursorChartRecord = { ...luna, modelId: "composer-2-5", modelName: "Composer 2.5", provider: "cursor", isThirdParty: false };
const grok: DerivedCursorChartRecord = { ...luna, modelId: "grok-4-6", modelName: "Grok 4.6", provider: "xai", isThirdParty: true };
const fable: DerivedCursorChartRecord = { ...luna, modelId: "fable-5-max", modelName: "Fable 5 Max", provider: "unknown", tokensPerTask: 103_525, publishedCostUsd: 17.32 };

describe("Cursor token-rate pricing", () => {
  it("uses current profiles with distinct cache-write prices", () => {
    expect(cursorTokenRateProfile(luna)).toEqual({ inputPriceUsdPerMillion: 0.2, cacheReadPriceUsdPerMillion: 0.02, cacheWritePriceUsdPerMillion: 0.25, outputPriceUsdPerMillion: 1.2 });
    expect(cursorTokenRateProfile({ modelId: "gpt-5-6-sol-high" })).toEqual({ inputPriceUsdPerMillion: 4, cacheReadPriceUsdPerMillion: 0.4, cacheWritePriceUsdPerMillion: 5, outputPriceUsdPerMillion: 20 });
    expect(cursorTokenRateProfile({ modelId: "gpt-5-6-terra-high" })).toMatchObject({ cacheWritePriceUsdPerMillion: 2.5 });
    expect(cursorTokenRateProfile({ modelId: "opus-5-max" })).toMatchObject({ cacheWritePriceUsdPerMillion: 6.25 });
    expect(cursorTokenRateProfile({ modelId: "sonnet-5-max" })).toMatchObject({ inputPriceUsdPerMillion: 2, cacheWritePriceUsdPerMillion: 2.5, outputPriceUsdPerMillion: 10 });
    expect(cursorTokenRateProfile({ modelId: "gemini-3-1-pro-high" })).toMatchObject({ cacheWritePriceUsdPerMillion: undefined });
    expect(cursorTokenRateProfile(fable)).toMatchObject({ inputPriceUsdPerMillion: 10, cacheWritePriceUsdPerMillion: 12.5 });
  });

  it("blends physical cache-read share with the central non-cached rate", () => {
    const profile = cursorTokenRateProfile(luna)!;
    expect(cursorNonOutputPrices(profile)).toEqual([0.2, 0.02, 0.25]);
    expect(blendCursorNonOutputPrice(profile, 0)).toBeCloseTo((0.2 + 0.25) / 2, 12);
    expect(blendCursorNonOutputPrice(profile, 90)).toBeCloseTo(0.9 * 0.02 + 0.1 * 0.225, 12);
    expect(blendCursorNonOutputPrice(profile, 100)).toBe(0.02);
  });

  it("subtracts known completion cost before estimating hidden and total tokens", () => {
    const estimate = estimateCursorTokenRate(luna, 90)!;
    const outputCost = (100_000 / 1e6) * 1.2;
    const blended = 0.9 * 0.02 + 0.1 * ((0.2 + 0.25) / 2);
    const hidden = ((1 - outputCost) / blended) * 1e6;
    expect(estimate.cacheHitRatePercent).toBe(90);
    expect(estimate.outputCostUsd).toBeCloseTo(outputCost, 12);
    expect(estimate.residualNonOutputCostUsd).toBeCloseTo(1 - outputCost, 12);
    expect(estimate.hiddenTokens).toBeCloseTo(hidden, 6);
    expect(estimate.totalTokens).toBeCloseTo(hidden + 100_000, 6);
  });

  it("reports uncertainty from input/cache-write prices at the selected hit rate", () => {
    const estimate = estimateCursorTokenRate(luna, 90)!;
    expect(estimate.surchargeRangeUsd[0]).toBeLessThanOrEqual(estimate.surchargeUsd);
    expect(estimate.surchargeUsd).toBeLessThanOrEqual(estimate.surchargeRangeUsd[1]);
    expect(estimate.surchargeRangeUsd[0]).not.toBe(estimate.surchargeRangeUsd[1]);
  });

  it("uses tokensPerTask as completion tokens, never as total tokens", () => {
    const record = { ...luna, tokensPerTask: 200_000, outputTokens: 1_000 };
    expect(cursorCompletionTokens(record)).toBe(200_000);
    expect(estimateCursorTokenRate(record, 90)?.totalTokens).toBeGreaterThan(200_000);
  });

  it("exempts Cursor Models Grok 4.6, Grok 4.5, and Composer 2.5", () => {
    expect(isCursorFirstPartyModel("grok-4-6-high")).toBe(true);
    expect(isCursorFirstPartyModel("grok-4-5")).toBe(true);
    expect(isCursorFirstPartyModel("composer-2-5-max")).toBe(true);
    expect(estimateCursorTokenRate(composer, 90)).toBeNull();
    expect(estimateCursorTokenRate(grok, 90)).toBeNull();
  });

  it("fails closed for invalid inputs and negative residuals", () => {
    expect(estimateCursorTokenRate({ ...luna, tokensPerTask: undefined }, 90)).toBeNull();
    expect(estimateCursorTokenRate({ ...luna, publishedCostUsd: -1 }, 90)).toBeNull();
    expect(blendCursorNonOutputPrice(cursorTokenRateProfile(luna)!, -1)).toBeNull();
    expect(blendCursorNonOutputPrice(cursorTokenRateProfile(luna)!, 101)).toBeNull();
    expect(estimateCursorTokenRate({ ...luna, publishedCostUsd: 0.01 }, 90)).toBeNull();
  });
});
