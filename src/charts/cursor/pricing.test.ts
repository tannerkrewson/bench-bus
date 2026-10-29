import { describe, expect, it } from "vitest";
import type { DerivedCursorChartRecord } from "../../schemas";
import {
  blendCursorNonOutputPrice, cursorCompletionTokens, cursorNonOutputPrices,
  cursorTokenRateProfile, estimateCursorTokenRate, isCursorFirstPartyModel,
} from "./pricing";

const sol: DerivedCursorChartRecord = {
  modelId: "gpt-5-6-sol-low", modelName: "GPT-5.6 Sol Low", provider: "openai",
  isThirdParty: true, score: 70, tokensPerTask: 100_000, publishedCostUsd: 10,
};

describe("Cursor token-rate pricing", () => {
  it("uses exact release-specific rate cards instead of prefix inheritance", () => {
    expect(cursorTokenRateProfile(sol)).toEqual({ inputPriceUsdPerMillion: 4, cacheReadPriceUsdPerMillion: 0.4, cacheWritePriceUsdPerMillion: 5, outputPriceUsdPerMillion: 20 });
    expect(cursorTokenRateProfile({ modelId: "opus-5-max" })).toMatchObject({ inputPriceUsdPerMillion: 5, cacheReadPriceUsdPerMillion: 0.5, outputPriceUsdPerMillion: 25 });
    expect(cursorTokenRateProfile({ modelId: "opus-5-5-max" })).toMatchObject({ inputPriceUsdPerMillion: 4, cacheReadPriceUsdPerMillion: 0.2, outputPriceUsdPerMillion: 20 });
    expect(cursorTokenRateProfile({ modelId: "sonnet-5-5-high" })).toMatchObject({ cacheReadPriceUsdPerMillion: 0.1 });
    expect(cursorTokenRateProfile({ modelId: "fable-5-1-max" })).toMatchObject({ cacheReadPriceUsdPerMillion: 0.25 });
    expect(cursorTokenRateProfile({ modelId: "gemini-3-8-flash-high" })).toMatchObject({ outputPriceUsdPerMillion: 3.75 });
    expect(cursorTokenRateProfile({ modelId: "opus-5-6-max" })).toBeNull();
    expect(cursorTokenRateProfile({ modelId: "gpt-5-6-sol-pro-high" })).toBeNull();
  });

  it("blends physical cache-read share with the central non-cached rate", () => {
    const profile = cursorTokenRateProfile(sol)!;
    expect(cursorNonOutputPrices(profile)).toEqual([4, 0.4, 5]);
    expect(blendCursorNonOutputPrice(profile, 0)).toBe(4.5);
    expect(blendCursorNonOutputPrice(profile, 90)).toBeCloseTo(0.9 * 0.4 + 0.1 * 4.5, 12);
    expect(blendCursorNonOutputPrice(profile, 100)).toBe(0.4);
  });

  it("subtracts completion cost before inferring hidden and total tokens", () => {
    const estimate = estimateCursorTokenRate(sol, 90)!;
    const outputCost = 100_000 / 1e6 * 20;
    const hidden = (10 - outputCost) / (0.9 * 0.4 + 0.1 * 4.5) * 1e6;
    expect(estimate.outputCostUsd).toBe(outputCost);
    expect(estimate.residualNonOutputCostUsd).toBe(8);
    expect(estimate.hiddenTokens).toBeCloseTo(hidden, 6);
    expect(estimate.totalTokens).toBeCloseTo(hidden + 100_000, 6);
    expect(estimate.adjustedCostUsd).toBeCloseTo(10 + (hidden + 100_000) / 1e6 * 0.25, 12);
    expect(estimate.surchargeRangeUsd[0]).toBeLessThanOrEqual(estimate.surchargeUsd);
    expect(estimate.surchargeUsd).toBeLessThanOrEqual(estimate.surchargeRangeUsd[1]);
  });

  it.each([
    ["opus-5-5-high", 3.97, 53_078, 4, 0.2, 5, 20],
    ["sonnet-5-5-high", 1.2, 37_391, 2, 0.1, 2.5, 10],
    ["fable-5-1-high", 9.08, 58_438, 10, 0.25, 12.5, 50],
    ["deepseek-v4-1-flash-1017-high", 0.77, 385_196, 0.3, 0.006, undefined, 1.2],
    ["gemini-4-argon-high", 4.57, 109_500, 2, 0.1, undefined, 10],
    ["muse-spark-1-3-high", 1.66, 30_654, 1.25, 0.15, undefined, 4.25],
    ["muse-wonder-high", 3.51, 33_612, 4, 0.2, undefined, 20],
    ["glm-5-3-high", 3.24, 60_031, 1.4, 0.26, undefined, 4.4],
  ] as const)("applies a fee to current eligible %s with verified rates", (modelId, cost, tokens, input, cache, write, output) => {
    const record = { ...sol, modelId, publishedCostUsd: cost, tokensPerTask: tokens };
    const estimate = estimateCursorTokenRate(record, 90)!;
    const blended = 0.9 * cache + 0.1 * (write === undefined ? input : (input + write) / 2);
    const total = (cost - tokens / 1e6 * output) / blended * 1e6 + tokens;
    expect(estimate.surchargeUsd).toBeCloseTo(total / 1e6 * 0.25, 12);
    expect(estimate.adjustedCostUsd).toBeGreaterThan(cost);
  });

  it.each(["haiku-5-5-high", "gpt-5-6-luna-low", "gemini-3-8-flash-high", "glm-5-3-flash-high", "grok-4-7-high", "composer-2-5"])("does not estimate a fee for exempt %s even with stale third-party flags", (modelId) => {
    expect(estimateCursorTokenRate({ ...sol, modelId }, 90)).toBeNull();
  });

  it("recognizes all documented Cursor models", () => {
    for (const id of ["grok-4-5", "grok-4-6-high", "grok-4-7-extra-high", "composer-2-5"]) {
      expect(isCursorFirstPartyModel(id)).toBe(true);
    }
  });

  it("uses completion tokens, never mistakes them for total processed tokens", () => {
    const record = { ...sol, tokensPerTask: 200_000, outputTokens: 1_000 };
    expect(cursorCompletionTokens(record)).toBe(200_000);
    expect(estimateCursorTokenRate(record, 90)?.totalTokens).toBeGreaterThan(200_000);
  });

  it("fails closed for missing data, invalid cache rates, and negative residuals", () => {
    expect(estimateCursorTokenRate({ ...sol, tokensPerTask: undefined }, 90)).toBeNull();
    expect(estimateCursorTokenRate({ ...sol, publishedCostUsd: -1 }, 90)).toBeNull();
    expect(estimateCursorTokenRate({ ...sol, modelId: "unknown" }, 90)).toBeNull();
    expect(estimateCursorTokenRate({ ...sol, publishedCostUsd: 0.01 }, 90)).toBeNull();
    expect(blendCursorNonOutputPrice(cursorTokenRateProfile(sol)!, -1)).toBeNull();
    expect(blendCursorNonOutputPrice(cursorTokenRateProfile(sol)!, 101)).toBeNull();
  });
});
