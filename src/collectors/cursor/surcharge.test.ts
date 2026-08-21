import { describe, expect, it } from "vitest";
import {
  CURSOR_THIRD_PARTY_SURCHARGE_USD_PER_MILLION_TOKENS,
  computeCursorSurcharges,
  computeThirdPartySurchargeUsd,
} from "./surcharge";
import type { CursorEvalRecord } from "../../schemas";

const thirdParty: CursorEvalRecord = {
  modelId: "grok-4-6-extra-high",
  modelName: "Grok 4.6 Extra High",
  provider: "xai",
  isThirdParty: true,
  score: 70.8,
  publishedCostUsd: 2.81,
};

const firstParty: CursorEvalRecord = {
  modelId: "composer-2-5",
  modelName: "Composer 2.5",
  provider: "cursor",
  isThirdParty: false,
  score: 55.1,
  publishedCostUsd: 1.1,
};

describe("computeThirdPartySurchargeUsd", () => {
  it("applies exactly $0.25 per million tokens", () => {
    expect(computeThirdPartySurchargeUsd(1_000_000)).toBeCloseTo(0.25, 10);
    expect(computeThirdPartySurchargeUsd(41136)).toBeCloseTo((41136 / 1_000_000) * 0.25, 10);
    expect(CURSOR_THIRD_PARTY_SURCHARGE_USD_PER_MILLION_TOKENS).toBe(0.25);
  });

  it("is zero for zero tokens and supports a custom rate", () => {
    expect(computeThirdPartySurchargeUsd(0)).toBe(0);
    expect(computeThirdPartySurchargeUsd(2_000_000, 0.5)).toBeCloseTo(1, 10);
  });

  it("rejects negative or non-finite inputs", () => {
    expect(() => computeThirdPartySurchargeUsd(-1)).toThrow(TypeError);
    expect(() => computeThirdPartySurchargeUsd(Number.NaN)).toThrow(TypeError);
    expect(() => computeThirdPartySurchargeUsd(100, -0.25)).toThrow(TypeError);
  });
});

describe("computeCursorSurcharges", () => {
  const tokens = new Map<string, number>([
    ["grok-4-6-extra-high", 41136],
    ["composer-2-5", 50_000],
  ]);

  it("charges the surcharge only to third-party rows with a known token count", () => {
    const results = computeCursorSurcharges([thirdParty, firstParty], tokens);
    expect(results).toHaveLength(2);

    const grok = results.find((result) => result.modelId === "grok-4-6-extra-high");
    expect(grok?.surchargeUsd).toBeCloseTo((41136 / 1_000_000) * 0.25, 10);
    expect(grok?.costWithSurchargeUsd).toBeCloseTo(2.81 + (41136 / 1_000_000) * 0.25, 10);

    const composer = results.find((result) => result.modelId === "composer-2-5");
    expect(composer?.surchargeUsd).toBe(0);
    expect(composer?.costWithSurchargeUsd).toBe(1.1);
  });

  it("never mutates or bakes the surcharge into the canonical records", () => {
    computeCursorSurcharges([thirdParty], tokens);
    expect(thirdParty.publishedCostUsd).toBe(2.81);
  });

  it("applies no surcharge when the token count is unknown rather than guessing", () => {
    const results = computeCursorSurcharges([thirdParty], new Map());
    expect(results[0]?.surchargeUsd).toBe(0);
    expect(results[0]?.costWithSurchargeUsd).toBe(2.81);
  });
});
