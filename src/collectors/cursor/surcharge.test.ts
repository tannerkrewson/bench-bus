import { describe, expect, it } from "vitest";
import {
  CURSOR_THIRD_PARTY_SURCHARGE_USD_PER_MILLION_TOKENS,
  computeThirdPartySurchargeUsd,
} from "./surcharge";

describe("computeThirdPartySurchargeUsd", () => {
  it("applies exactly $0.25 per million estimated processed tokens", () => {
    expect(computeThirdPartySurchargeUsd(1_000_000)).toBeCloseTo(0.25, 10);
    expect(computeThirdPartySurchargeUsd(41_136)).toBeCloseTo((41_136 / 1_000_000) * 0.25, 10);
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
