import { describe, expect, it } from "vitest";
import { validAaModel } from "../../schemas/fixtures/aa";
import { aaListedWorkloadCost, computeAaListedParetoFrontier } from "./frontier";

function model(slug: string, cost: number, score: number) {
  return {
    ...validAaModel,
    id: `vendor/${slug}`,
    slug,
    intelligenceIndex: score,
    price1mInputTokens: cost,
    price1mOutputTokens: 0,
    cacheHitPrice: cost,
    canonicalIntelligenceIndexTokenCount: {
      input: 1_000_000,
      output: 0,
      answer: 0,
      reasoning: 0,
    },
  };
}

describe("AA listed Pareto frontier", () => {
  it("uses the canonical workload and the deterministic 90% cache-hit default", () => {
    expect(aaListedWorkloadCost(validAaModel)).toBe(
      0.135 * 0.5 + 0.015 * 5 + 0.045 * 25,
    );
  });

  it("keeps frontier points, removes dominated points, and resolves duplicates deterministically", () => {
    const result = computeAaListedParetoFrontier([
      model("dominated", 10, 20),
      model("frontier-low", 1, 30),
      model("frontier-high", 2, 40),
      model("duplicate-score-b", 1, 30),
      model("duplicate-score-a", 1, 30),
    ]);
    expect(result.map((point) => point.slug)).toEqual([
      "duplicate-score-a",
      "frontier-high",
    ]);
  });

  it("ignores malformed or unplottable values safely", () => {
    const invalid = { ...validAaModel, slug: "invalid", price1mInputTokens: Number.NaN };
    const zero = { ...validAaModel, slug: "zero", price1mInputTokens: 0, price1mOutputTokens: 0, cacheHitPrice: 0 };
    expect(computeAaListedParetoFrontier([invalid, zero])).toEqual([]);
  });
});
