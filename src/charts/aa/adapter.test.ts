import { describe, expect, it } from "vitest";
import { derivedAaDatasetSchema, SCHEMA_VERSIONS } from "../../schemas";
import { decodeBundle } from "../../derived/encode";
import {
  aaAdapter,
  aaControlledTooltipLines,
  AA_BENCHMARK_ID,
  openRouterUrlForAaModel,
} from "./adapter";
import {
  AA_FIXTURE_RECORDS,
  AA_RECORD_CROSS_PROVIDER,
  AA_RECORD_NO_LISTING,
  AA_RECORD_PLOTTABLE_CHEAPEST,
  AA_RECORD_UNPLOTTABLE,
  BUNDLE_AS_OF,
  makeAaBundleFixture,
} from "./fixtures";

describe("aa fixtures and decode path", () => {
  it("fixture records are schema-valid derived AA records", () => {
    const freshness = {
      schemaVersion: SCHEMA_VERSIONS.derived,
      asOf: BUNDLE_AS_OF,
      aaObservedAt: BUNDLE_AS_OF,
      openrouterObservedAt: BUNDLE_AS_OF,
      deepsweObservedAt: BUNDLE_AS_OF,
      cursorObservedAt: BUNDLE_AS_OF,
    };
    expect(() => derivedAaDatasetSchema.parse({ freshness, records: AA_FIXTURE_RECORDS })).not.toThrow();
  });

  it("fixture bundle decodes through the real decodeBundle path", () => {
    const decoded = decodeBundle(JSON.parse(JSON.stringify(makeAaBundleFixture())));
    expect(decoded.aa).not.toBeNull();
    expect(decoded.aa?.records).toHaveLength(AA_FIXTURE_RECORDS.length);
    expect(decoded.aa?.freshness.aaObservedAt).toBe(BUNDLE_AS_OF);
    expect(decoded.sources.openrouter).toEqual({ available: true, observedAt: BUNDLE_AS_OF });
    expect(decoded.cursor).toBeNull();
  });
});

describe("aaAdapter.computePoint", () => {
  const controls = { scoreSource: "aa", pricingMode: "cheapest", cacheHitRate: 0.9 };

  it("links confirmed model identities and omits unknown identities", () => {
    expect(openRouterUrlForAaModel(AA_RECORD_PLOTTABLE_CHEAPEST)).toBe(
      "https://openrouter.ai/anthropic/claude-opus-5",
    );
    expect(openRouterUrlForAaModel({ ...AA_RECORD_PLOTTABLE_CHEAPEST, slug: "unmapped-model" })).toBeUndefined();
    expect(openRouterUrlForAaModel({ ...AA_RECORD_PLOTTABLE_CHEAPEST, slug: "gpt-5-6-sol-medium" })).toBe(
      "https://openrouter.ai/openai/gpt-5.6-sol",
    );
    expect(openRouterUrlForAaModel({ ...AA_RECORD_PLOTTABLE_CHEAPEST, slug: "grok-4-6" })).toBe(
      "https://openrouter.ai/x-ai/grok-4.6",
    );
    expect(openRouterUrlForAaModel({ ...AA_RECORD_PLOTTABLE_CHEAPEST, slug: "grok-4-6-medium" })).toBe(
      "https://openrouter.ai/x-ai/grok-4.6",
    );
    expect(openRouterUrlForAaModel({ ...AA_RECORD_PLOTTABLE_CHEAPEST, slug: "glm-5-3-flash" })).toBe(
      "https://openrouter.ai/z-ai/glm-5.3-flash",
    );
    expect(openRouterUrlForAaModel({ ...AA_RECORD_PLOTTABLE_CHEAPEST, slug: "qwen3-8-flash-next" })).toBe(
      "https://openrouter.ai/qwen/qwen3.8-flash",
    );
    expect(openRouterUrlForAaModel({ ...AA_RECORD_PLOTTABLE_CHEAPEST, slug: "deepseek-v4-flash-0420" })).toBe(
      "https://openrouter.ai/deepseek/deepseek-v4-flash",
    );
    expect(openRouterUrlForAaModel({ ...AA_RECORD_PLOTTABLE_CHEAPEST, slug: "deepseek-v4-flash" })).toBe(
      "https://openrouter.ai/deepseek/deepseek-v4-flash-0731",
    );
    expect(openRouterUrlForAaModel({ ...AA_RECORD_PLOTTABLE_CHEAPEST, slug: "deepseek-v4-pro-0424" })).toBe(
      "https://openrouter.ai/deepseek/deepseek-v4-pro",
    );
    expect(openRouterUrlForAaModel({ ...AA_RECORD_PLOTTABLE_CHEAPEST, slug: "hy3" })).toBe(
      "https://openrouter.ai/tencent/hy3",
    );
    expect(openRouterUrlForAaModel({ ...AA_RECORD_PLOTTABLE_CHEAPEST, slug: "minimax-m3" })).toBe(
      "https://openrouter.ai/minimax/minimax-m3",
    );
  });

  it("plots Intelligence Index against cheapest-provider workload cost", () => {
    const point = aaAdapter.computePoint(AA_RECORD_PLOTTABLE_CHEAPEST, controls);
    expect(point).not.toBeNull();
    expect(point?.y).toBe(71.2);
    expect(point?.id).toBe("claude-opus-5");
    expect(point?.x).toBeCloseTo(
      (AA_RECORD_PLOTTABLE_CHEAPEST.canonicalTokens.input / 1e6) * 2.2 +
        (AA_RECORD_PLOTTABLE_CHEAPEST.canonicalTokens.output / 1e6) * 13.9,
      8,
    );
  });

  it("uses AA listed pricing for a model before OpenRouter publishes a row", () => {
    const aaOnly = {
      ...AA_RECORD_UNPLOTTABLE,
      listed: { price1mInputTokens: 10, price1mOutputTokens: 50, cacheHitPrice: 1 },
    };
    const point = aaAdapter.computePoint(aaOnly, controls);
    expect(point).not.toBeNull();
    expect(point?.x).toBeCloseTo(
      (aaOnly.canonicalTokens.input * 0.9 / 1e6) * 1 +
        (aaOnly.canonicalTokens.input * 0.1 / 1e6) * 10 +
        (aaOnly.canonicalTokens.output / 1e6) * 50,
      8,
    );
    expect(point?.discount).toBeUndefined();
    const provider = aaControlledTooltipLines(aaOnly, point!, controls).find(
      (line) => line.label === "Winning provider",
    );
    expect(provider?.value).toBe("AA listed pricing");
  });

  it("plots DeepSWE pass@1 as a percentage when selected", () => {
    const point = aaAdapter.computePoint(AA_RECORD_PLOTTABLE_CHEAPEST, {
      scoreSource: "deepswe",
      pricingMode: "cheapest",
      cacheHitRate: 0.9,
    });
    expect(point?.y).toBe(51.2);
  });

  it("uses parenthesis-free labels and stable families for verbose DeepSeek and Luna sources", () => {
    const deepSeek = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      slug: "deepseek-v4-flash-0731",
      name: "DeepSeek V4 Flash 0731 (Reasoning, Max Effort)",
    };
    const luna = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      slug: "gpt-5-6-luna-non-reasoning",
      name: "GPT-5.6 Luna (Non-reasoning)",
    };
    const deepSeekPoint = aaAdapter.computePoint(deepSeek, controls)!;
    const lunaPoint = aaAdapter.computePoint(luna, controls);
    expect(deepSeekPoint).toMatchObject({
      label: "DeepSeek v4 Flash 0731 max",
      effort: "max",
      effortGroup: "deepseek-v4-flash-0731",
    });
    expect(lunaPoint).toBeNull();
    expect(deepSeekPoint.label).not.toMatch(/[()]/);
  });

  it("adds the legacy DeepSeek release marker to concise selector labels", () => {
    const point = aaAdapter.computePoint({
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      slug: "deepseek-v4-flash-0420",
      name: "DeepSeek V4 Flash",
    }, controls)!;
    expect(point).toMatchObject({
      label: "DeepSeek v4 Flash 0423",
      selectionLabel: "DeepSeek v4 Flash 0423",
      effortGroup: "deepseek-v4-flash-0423",
    });
  });

  it("adds the canonical current DeepSeek release to bare AA labels", () => {
    const flash = aaAdapter.computePoint({
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      slug: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
    }, controls)!;
    const pro = aaAdapter.computePoint({
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      slug: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
    }, controls)!;
    expect(flash).toMatchObject({
      label: "DeepSeek v4 Flash 0731",
      selectionLabel: "DeepSeek v4 Flash 0731",
    });
    expect(pro).toMatchObject({
      label: "DeepSeek v4 Pro 0813",
      selectionLabel: "DeepSeek v4 Pro 0813",
    });
  });

  it("compares the cheapest provider against AA listed workload pricing", () => {
    const record = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      canonicalTokens: { input: 1_000_000, output: 1_000_000 },
      providers: [{
        providerName: "Cheapest Provider",
        providerSlug: "cheapest",
        effectiveInputPrice: 6,
        effectiveOutputPrice: 12,
        listedInputPrice: 10,
        listedOutputPrice: 20,
        discountPercentage: 40,
      }],
      listed: { price1mInputTokens: 10, price1mOutputTokens: 20, cacheHitPrice: 10 },
    };
    const point = aaAdapter.computePoint(record, controls)!;
    expect(point.x).toBe(18);
    expect(point.discount).toEqual({
      percentage: 40,
      preDiscountX: 30,
      effectiveX: 18,
      providerName: "Cheapest Provider",
    });
  });

  it("uses the active cache-hit rate for the AA listed comparison", () => {
    const record = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      canonicalTokens: { input: 1_000_000, output: 1_000_000 },
      providers: [{
        providerName: "Cheapest Provider",
        providerSlug: "cheapest",
        effectiveInputPrice: 6,
        effectiveOutputPrice: 12,
      }],
      listed: { price1mInputTokens: 10, price1mOutputTokens: 20, cacheHitPrice: 0 },
    };
    const point = aaAdapter.computePoint(record, { ...controls, cacheHitRate: 0.5 })!;
    expect(point.discount).toMatchObject({
      preDiscountX: 25,
      effectiveX: 18,
      providerName: "Cheapest Provider",
    });
    expect(point.discount?.percentage).toBeCloseTo(28, 10);
  });

  it("uses the cheapest provider and ignores source promotion percentages", () => {
    const record = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      canonicalTokens: { input: 1_000_000, output: 1_000_000 },
      providers: [
        {
          providerName: "Cheapest Provider",
          providerSlug: "cheapest",
          effectiveInputPrice: 1,
          effectiveOutputPrice: 2,
          listedInputPrice: 100,
          listedOutputPrice: 200,
          discountPercentage: 1,
        },
        {
          providerName: "Promoted Provider",
          providerSlug: "promoted",
          effectiveInputPrice: 3,
          effectiveOutputPrice: 4,
          listedInputPrice: 4,
          listedOutputPrice: 6,
          discountPercentage: 99,
        },
      ],
      listed: { price1mInputTokens: 10, price1mOutputTokens: 20, cacheHitPrice: 10 },
    };
    const point = aaAdapter.computePoint(record, controls)!;
    expect(point.x).toBe(3);
    expect(point.discount).toEqual({
      percentage: 90,
      preDiscountX: 30,
      effectiveX: 3,
      providerName: "Cheapest Provider",
    });
  });

  it("keeps Flex out of the default discount and allows an explicit opt-in", () => {
    const record = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      canonicalTokens: { input: 1_000_000, output: 1_000_000 },
      providers: [
        {
          providerName: "OpenAI (1)",
          providerSlug: "openai",
          serviceTier: "flex",
          effectiveInputPrice: 1,
          effectiveOutputPrice: 2,
        },
        {
          providerName: "OpenAI",
          providerSlug: "openai",
          effectiveInputPrice: 4,
          effectiveOutputPrice: 8,
        },
      ],
      listed: { price1mInputTokens: 10, price1mOutputTokens: 20, cacheHitPrice: 10 },
    };
    const regular = aaAdapter.computePoint(record, controls)!;
    expect(regular.x).toBe(12);
    expect(regular.discount?.providerName).toBe("OpenAI");
    const withFlex = aaAdapter.computePoint(record, { ...controls, includeFlex: true })!;
    expect(withFlex.x).toBe(3);
    expect(withFlex.discount?.providerName).toBe("OpenAI (1) Flex");
  });

  it("suppresses savings at the one-percent tolerance boundary", () => {
    const record = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      canonicalTokens: { input: 1_000_000, output: 1_000_000 },
      providers: [{
        providerName: "Nearly Equal Provider",
        providerSlug: "nearly-equal",
        effectiveInputPrice: 9.9,
        effectiveOutputPrice: 19.8,
        listedInputPrice: 10,
        listedOutputPrice: 20,
        discountPercentage: 50,
      }],
      listed: { price1mInputTokens: 10, price1mOutputTokens: 20, cacheHitPrice: 10 },
    };
    const point = aaAdapter.computePoint(record, controls)!;
    expect(point.discount).toBeUndefined();
  });

  it("does not infer savings when AA listed pricing is absent", () => {
    const point = aaAdapter.computePoint(AA_RECORD_NO_LISTING, controls)!;
    expect(point.discount).toBeUndefined();
  });

  it("weighted mode uses the record's weighted prices", () => {
    const { canonicalTokens, weighted } = AA_RECORD_PLOTTABLE_CHEAPEST;
    const point = aaAdapter.computePoint(AA_RECORD_PLOTTABLE_CHEAPEST, {
      pricingMode: "weighted",
      cacheHitRate: 0.9,
    });
    expect(point?.x).toBeCloseTo(
      (canonicalTokens.input / 1e6) * weighted.weightedInputPrice +
        (canonicalTokens.output / 1e6) * weighted.weightedOutputPrice,
      8,
    );
  });

  it("listed mode applies the cache-hit slider value", () => {
    const { canonicalTokens, listed } = AA_RECORD_PLOTTABLE_CHEAPEST;
    const at50 = aaAdapter.computePoint(AA_RECORD_PLOTTABLE_CHEAPEST, {
      pricingMode: "listed",
      cacheHitRate: 0.5,
    });
    const expected =
      (canonicalTokens.input * 0.5 * listed.cacheHitPrice) / 1e6 +
      (canonicalTokens.input * 0.5 * listed.price1mInputTokens) / 1e6 +
      (canonicalTokens.output * listed.price1mOutputTokens) / 1e6;
    expect(at50?.x).toBeCloseTo(expected, 8);
  });

  it("treats models with no providers or listed pricing as unplottable", () => {
    for (const mode of ["cheapest", "weighted", "listed"]) {
      const point = aaAdapter.computePoint(AA_RECORD_UNPLOTTABLE, {
        pricingMode: mode,
        cacheHitRate: 0.9,
      });
      expect(point).toBeNull();
    }
  });

  it("treats missing listed pricing as unplottable in listed mode only", () => {
    expect(
      aaAdapter.computePoint(AA_RECORD_NO_LISTING, { pricingMode: "listed", cacheHitRate: 0.9 }),
    ).toBeNull();
    expect(
      aaAdapter.computePoint(AA_RECORD_NO_LISTING, { pricingMode: "cheapest", cacheHitRate: 0.9 }),
    ).not.toBeNull();
  });

  it("omits models with no DeepSWE score when that source is selected", () => {
    expect(
      aaAdapter.computePoint(AA_RECORD_NO_LISTING, {
        scoreSource: "deepswe",
        pricingMode: "cheapest",
        cacheHitRate: 0.9,
      }),
    ).toBeNull();
    expect(aaAdapter.unplottableLabel).toBeUndefined();
    expect(aaAdapter.unplottableDescription).toBeUndefined();
  });

  it("falls back to control defaults when controls are missing", () => {
    const point = aaAdapter.computePoint(AA_RECORD_PLOTTABLE_CHEAPEST, {});
    expect(point).not.toBeNull(); // defaults: cheapest mode
  });

  it("uses the generic unplottable handling without a pricing-mode escape hatch", () => {
    expect(aaAdapter.unplottableLabel).toBeUndefined();
    expect(aaAdapter.unplottableDescription).toBeUndefined();
  });

  it("exposes the service-tier control alongside pricing controls", () => {
    const ids = aaAdapter.controlSpecs.map((s) => s.id);
    expect(ids).toEqual(["scoreSource", "pricingMode", "cacheHitRate", "includeFlex"]);
  });
});

describe("aa tooltips and metadata", () => {
  it("controlled tooltip includes winning provider without repeating pricing mode", () => {
    const point = aaAdapter.computePoint(AA_RECORD_PLOTTABLE_CHEAPEST, {
      pricingMode: "cheapest",
      cacheHitRate: 0.9,
    })!;
    const lines = aaControlledTooltipLines(AA_RECORD_PLOTTABLE_CHEAPEST, point, {
      pricingMode: "cheapest",
      cacheHitRate: 0.9,
    });
    const labels = lines.map((l) => l.label);
    expect(labels).not.toContain("Pricing mode");
    expect(labels).toContain("Winning provider");
    expect(labels).toContain("Workload tokens");
    const provider = lines.find((l) => l.label === "Winning provider");
    expect(provider?.value).toContain("Bedrock");
    expect(lines.find((l) => l.label === "Effective input rate")?.value).toContain("/ 1M tokens");
    expect(lines.find((l) => l.label === "Effective output rate")?.value).toContain("/ 1M tokens");
    const tokens = lines.find((l) => l.label === "Workload tokens");
    expect(tokens?.value).toContain("810.1M in");
  });

  it("controlled tooltip notes cache-write omission in listed mode", () => {
    const point = aaAdapter.computePoint(AA_RECORD_PLOTTABLE_CHEAPEST, {
      pricingMode: "listed",
      cacheHitRate: 0.9,
    })!;
    const lines = aaControlledTooltipLines(AA_RECORD_PLOTTABLE_CHEAPEST, point, {
      pricingMode: "listed",
      cacheHitRate: 0.9,
    });
    const cache = lines.find((l) => l.label === "Cache hit rate");
    expect(cache?.value).toContain("90%");
    expect(cache?.value).toContain("cache writes unknown");
  });

  it("uses the aa URL namespace and log default", () => {
    expect(AA_BENCHMARK_ID).toBe("aa");
    expect(aaAdapter.benchmarkId).toBe("aa");
    expect(aaAdapter.defaultXScale).toBe("log");
  });
});

describe("aaAdapter subtitle", () => {
  it("uses the requested concise methodology copy", () => {
    expect(aaAdapter.subtitle).toBe(
      "This chart compares AA listed prices with the cheapest regular effective OpenRouter provider for the real benchmark workload, updated multiple times per day as prices change",
    );
  });

  it("exposes verified source links independently from subtitle copy", () => {
    expect(aaAdapter.sourceLinks).toEqual([
      { label: "Artificial Analysis", href: "https://artificialanalysis.ai/" },
      { label: "OpenRouter", href: "https://openrouter.ai/" },
      { label: "DeepSWE", href: "https://deepswe.datacurve.ai/artifacts/v1/leaderboard-live.json" },
    ]);
  });
});

describe("aaAdapter cross-provider workload sensitivity", () => {
  it("cheapest winner flips with the workload shape (no provider mixing)", () => {
    const { providers } = AA_RECORD_CROSS_PROVIDER;
    // Input-dominated workload: InputCheap wins.
    const inputHeavy = selectWinner(providers, 900_000_000, 10_000_000);
    // Output-dominated workload: OutputCheap wins.
    const outputHeavy = selectWinner(providers, 10_000_000, 900_000_000);
    expect(inputHeavy).toBe("input-cheap");
    expect(outputHeavy).toBe("output-cheap");
  });
});

function selectWinner(
  providers: readonly { providerSlug: string; effectiveInputPrice: number; effectiveOutputPrice: number }[],
  input: number,
  output: number,
): string {
  let best: { slug: string; cost: number } | null = null;
  for (const p of providers) {
    const cost = (input / 1e6) * p.effectiveInputPrice + (output / 1e6) * p.effectiveOutputPrice;
    if (best === null || cost < best.cost) best = { slug: p.providerSlug, cost };
  }
  return best!.slug;
}
