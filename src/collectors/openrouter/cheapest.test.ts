import { describe, expect, it } from "vitest";
import type { OpenRouterProviderSummary } from "../../schemas/openrouter";
import { selectCheapestProvider, workloadCost } from "./cheapest";

function provider(
  slug: string,
  input: number,
  output: number,
): OpenRouterProviderSummary {
  return { providerName: slug, providerSlug: slug, effectiveInputPrice: input, effectiveOutputPrice: output };
}

describe("workloadCost", () => {
  it("computes input/1e6 * in + output/1e6 * out for one provider", () => {
    const p = provider("a", 2, 10);
    // 1M input tokens at $2/M + 0.5M output tokens at $10/M
    expect(workloadCost({ inputTokens: 1_000_000, outputTokens: 500_000 }, p)).toBe(7);
  });

  it("preserves fractional token counts exactly (real AA canonical workload)", () => {
    const p = provider("a", 1.205441732165264, 24.9999958112265);
    const cost = workloadCost({ inputTokens: 810_078_135, outputTokens: 114_542_834 }, p);
    // Hand-computed: 810.078135 * 1.205441732165264 + 114.542834 * 24.9999958112265
    expect(cost).toBeCloseTo(976.501990243607 + 2863.570370206012, 6);
  });
});

describe("selectCheapestProvider", () => {
  it("minimizes combined benchmark workload cost over a single provider", () => {
    const providers = [
      provider("cheap-input", 0.5, 30),
      provider("balanced", 2, 10),
      provider("cheap-output", 5, 8),
    ];
    const workload = { inputTokens: 10_000_000, outputTokens: 1_000_000 };
    const best = selectCheapestProvider(providers, workload);
    // balanced: 10*2 + 1*10 = 30; cheap-input: 10*0.5 + 1*30 = 35; cheap-output: 50+8 = 58
    expect(best?.provider.providerSlug).toBe("balanced");
    expect(best?.totalCost).toBe(30);
    expect(best?.inputCost).toBe(20);
    expect(best?.outputCost).toBe(10);
  });

  it("can select a provider that is not independently cheapest on either dimension", () => {
    const providers = [
      provider("min-input", 1, 100),
      provider("min-output", 50, 1),
      provider("middle", 4, 4),
    ];
    // 1M input, 1M output: min-input=101, min-output=51, middle=8 -> middle wins
    const best = selectCheapestProvider(providers, { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(best?.provider.providerSlug).toBe("middle");
  });

  it("never excludes rare/low-volume providers from selection", () => {
    const providers = [
      provider("giant", 5, 25),
      provider("tiny", 0.1, 0.2), // would win but has tiny volume in real data
    ];
    const best = selectCheapestProvider(providers, { inputTokens: 2_000_000, outputTokens: 1_000_000 });
    // Volume metadata is not part of the selection input at all.
    expect(best?.provider.providerSlug).toBe("tiny");
  });

  it("breaks ties deterministically toward the upstream array order", () => {
    const providers = [provider("first", 1, 1), provider("second", 1, 1)];
    const best = selectCheapestProvider(providers, { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(best?.provider.providerSlug).toBe("first");
  });

  it("returns undefined for an empty provider list (no data, not zero cost)", () => {
    expect(selectCheapestProvider([], { inputTokens: 1, outputTokens: 1 })).toBeUndefined();
  });

  it("handles zero-token workloads as zero cost for every provider", () => {
    const providers = [provider("a", 100, 100), provider("b", 0.01, 0.01)];
    const best = selectCheapestProvider(providers, { inputTokens: 0, outputTokens: 0 });
    expect(best?.totalCost).toBe(0);
    expect(best?.provider.providerSlug).toBe("a"); // first tie in upstream order
  });
});
