import { describe, expect, it } from "vitest";
import {
  AA_DEFAULT_CACHE_HIT_RATE,
  listedCostUsd,
  selectCheapestProvider,
  weightedCostUsd,
} from "./pricing";
import {
  AA_RECORD_CROSS_PROVIDER,
  AA_RECORD_NO_LISTING,
  AA_RECORD_PLOTTABLE_CHEAPEST,
  AA_RECORD_UNPLOTTABLE,
} from "./fixtures";

describe("selectCheapestProvider (cheapest-effective mode)", () => {
  const { canonicalTokens, providers } = AA_RECORD_PLOTTABLE_CHEAPEST;

  it("minimizes combined input+output cost over a SINGLE provider", () => {
    const winner = selectCheapestProvider(providers, canonicalTokens.input, canonicalTokens.output);
    expect(winner?.providerSlug).toBe("bedrock");
    const expected =
      (canonicalTokens.input / 1e6) * 2.2 + (canonicalTokens.output / 1e6) * 13.9;
    expect(winner?.totalCostUsd).toBeCloseTo(expected, 10);
  });

  it("can select a provider that is not independently cheapest on both dimensions", () => {
    // InputCheap has the cheaper input price; OutputCheap wins on the
    // output-heavy canonical workload (900M output tokens).
    const { canonicalTokens: tokens, providers: ps } = AA_RECORD_CROSS_PROVIDER;
    const winner = selectCheapestProvider(ps, tokens.input, tokens.output);
    expect(winner?.providerSlug).toBe("output-cheap");
    const expected = (tokens.input / 1e6) * 3.0 + (tokens.output / 1e6) * 5.0;
    expect(winner?.totalCostUsd).toBeCloseTo(expected, 10);
  });

  it("never mixes providers", () => {
    const winner = selectCheapestProvider(providers, canonicalTokens.input, canonicalTokens.output);
    // The hypothetical best-mix would be 2.2 input + 12.5 output; the winner
    // must be one real provider with its own pair of prices.
    expect(winner?.effectiveInputPrice).toBe(2.2);
    expect(winner?.effectiveOutputPrice).toBe(13.9);
  });

  it("returns null for an empty provider list (unplottable, not $0)", () => {
    expect(
      selectCheapestProvider(AA_RECORD_UNPLOTTABLE.providers, 1_000_000, 1_000_000),
    ).toBeNull();
  });

  it("ignores providers with negative or non-finite prices", () => {
    const winner = selectCheapestProvider(
      [
        {
          providerName: "Bad",
          providerSlug: "bad",
          effectiveInputPrice: Number.NaN,
          effectiveOutputPrice: -1,
        },
        { providerName: "Good", providerSlug: "good", effectiveInputPrice: 1, effectiveOutputPrice: 2 },
      ],
      1_000_000,
      1_000_000,
    );
    expect(winner?.providerSlug).toBe("good");
  });

  it("breaks ties deterministically by providerSlug then providerName", () => {
    const tied = [
      { providerName: "B", providerSlug: "zeta", effectiveInputPrice: 1, effectiveOutputPrice: 1 },
      { providerName: "A", providerSlug: "zeta", effectiveInputPrice: 1, effectiveOutputPrice: 1 },
      { providerName: "C", providerSlug: "alpha", effectiveInputPrice: 1, effectiveOutputPrice: 1 },
    ];
    expect(selectCheapestProvider(tied, 1_000_000, 1_000_000)?.providerSlug).toBe("alpha");
  });

  it("does not exclude cheap providers for being rare (no volume filter exists)", () => {
    const winner = selectCheapestProvider(
      [
        { providerName: "Giant", providerSlug: "giant", effectiveInputPrice: 10, effectiveOutputPrice: 10 },
        { providerName: "Tiny", providerSlug: "tiny", effectiveInputPrice: 0.01, effectiveOutputPrice: 0.01 },
      ],
      1_000_000,
      1_000_000,
    );
    expect(winner?.providerSlug).toBe("tiny");
  });
});

describe("weightedCostUsd (weighted mode)", () => {
  it("applies top-level weightedInputPrice/weightedOutputPrice to the canonical workload", () => {
    const { canonicalTokens, weighted } = AA_RECORD_PLOTTABLE_CHEAPEST;
    const expected =
      (canonicalTokens.input / 1e6) * weighted.weightedInputPrice +
      (canonicalTokens.output / 1e6) * weighted.weightedOutputPrice;
    expect(weightedCostUsd(weighted, canonicalTokens.input, canonicalTokens.output)).toBeCloseTo(
      expected,
      10,
    );
  });

  it("returns null for the all-zero empty-skeleton (never a fabricated $0)", () => {
    expect(weightedCostUsd(AA_RECORD_UNPLOTTABLE.weighted, 1_000_000, 1_000_000)).toBeNull();
  });

  it("allows one legitimately zero-sided price", () => {
    expect(weightedCostUsd({ weightedInputPrice: 0, weightedOutputPrice: 5 }, 1_000_000, 1_000_000)).toBe(
      5,
    );
  });
});

describe("listedCostUsd (AA listed mode with cache-hit slider)", () => {
  const { canonicalTokens, listed } = AA_RECORD_PLOTTABLE_CHEAPEST;
  const { input, output } = canonicalTokens;

  it("defaults the cache-hit rate to 90 percent", () => {
    expect(AA_DEFAULT_CACHE_HIT_RATE).toBe(0.9);
  });

  it("computes hit/miss input split plus output at the default 90% rate", () => {
    const expected =
      (input * 0.9 * listed.cacheHitPrice) / 1e6 +
      (input * 0.1 * listed.price1mInputTokens) / 1e6 +
      (output * listed.price1mOutputTokens) / 1e6;
    expect(listedCostUsd(listed, input, output, AA_DEFAULT_CACHE_HIT_RATE)).toBeCloseTo(expected, 8);
  });

  it("responds monotonically to the slider: 0% hit costs more than 90%", () => {
    const at0 = listedCostUsd(listed, input, output, 0)!;
    const at90 = listedCostUsd(listed, input, output, 0.9)!;
    const at100 = listedCostUsd(listed, input, output, 1)!;
    expect(at0).toBeGreaterThan(at90);
    expect(at90).toBeGreaterThan(at100);
    // 100% hit = all input at cacheHitPrice + output at output price.
    expect(at100).toBeCloseTo((input * listed.cacheHitPrice) / 1e6 + (output * listed.price1mOutputTokens) / 1e6, 8);
  });

  it("never uses cacheWritePrice (cache-write volume is unknown upstream)", () => {
    // The listed schema has no cacheWritePrice field at all; assert the
    // estimate depends only on the three published prices by checking a
    // hand-computed value exactly.
    const cost = listedCostUsd({ price1mInputTokens: 3, price1mOutputTokens: 15, cacheHitPrice: 0.3 }, 1_000_000, 1_000_000, 0.5);
    expect(cost).toBeCloseTo(0.5 * 0.3 + 0.5 * 3 + 15, 10);
  });

  it("returns null when the entire listing is zero (no listed pricing)", () => {
    expect(listedCostUsd(AA_RECORD_NO_LISTING.listed, 1_000_000, 1_000_000, 0.9)).toBeNull();
  });

  it("clamps out-of-range slider values", () => {
    const atMinus1 = listedCostUsd(listed, input, output, -1)!;
    const at0 = listedCostUsd(listed, input, output, 0)!;
    const at2 = listedCostUsd(listed, input, output, 2)!;
    const at1 = listedCostUsd(listed, input, output, 1)!;
    expect(atMinus1).toBe(at0);
    expect(at2).toBe(at1);
  });
});
