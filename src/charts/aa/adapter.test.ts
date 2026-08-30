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
    expect(openRouterUrlForAaModel({ ...AA_RECORD_PLOTTABLE_CHEAPEST, slug: "deepseek-v4-pro-0424" })).toBe(
      "https://openrouter.ai/deepseek/deepseek-v4-pro",
    );
    expect(openRouterUrlForAaModel({ ...AA_RECORD_PLOTTABLE_CHEAPEST, slug: "hy3" })).toBe(
      "https://openrouter.ai/tencent/hy3",
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

  it("uses the documented DeepSeek V4 Pro 0813 peak rates as raw listed prices", () => {
    const record = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      slug: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro 0813 (Reasoning, Max Effort)",
      shortName: "DeepSeek V4 Pro 0813 (max)",
      canonicalTokens: { input: 918_390_769, output: 127_918_722 },
      providers: [{
        providerName: "StreamLake",
        providerSlug: "streamlake",
        effectiveInputPrice: 0.5795,
        effectiveOutputPrice: 1.738,
        listedInputPrice: 1.32,
        listedOutputPrice: 3.96,
        discountPercentage: 56,
      }],
      listed: { price1mInputTokens: 1.32, price1mOutputTokens: 3.96, cacheHitPrice: 0.044 },
    };
    const point = aaAdapter.computePoint(record, controls)!;
    const rawCost = (918_390_769 / 1e6) * 1.32 + (127_918_722 / 1e6) * 3.96;
    expect(point.discount?.preDiscountX).toBeCloseTo(rawCost, 10);
    expect(point.discount?.percentage).toBeCloseTo(
      (1 - point.x / rawCost) * 100,
      10,
    );
  });

  it("annotates only a cheapest provider with explicit listed-price discount metadata", () => {
    const record = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      canonicalTokens: { input: 1_000_000, output: 1_000_000 },
      providers: [{
        providerName: "Discounted Provider",
        providerSlug: "discounted",
        effectiveInputPrice: 6,
        effectiveOutputPrice: 12,
        listedInputPrice: 10,
        listedOutputPrice: 20,
        discountPercentage: 40,
      }],
    };
    const point = aaAdapter.computePoint(record, controls)!;
    expect(point.x).toBe(18);
    expect(point.discount).toEqual({
      percentage: 40,
      preDiscountX: 30,
      providerName: "Discounted Provider",
    });
  });

  it("uses the workload ratio instead of an inconsistent provider percentage", () => {
    const record = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      canonicalTokens: { input: 1_000_000, output: 1_000_000 },
      providers: [{
        providerName: "Free input provider",
        providerSlug: "free-input",
        effectiveInputPrice: 0,
        effectiveOutputPrice: 12,
        listedInputPrice: 10,
        listedOutputPrice: 20,
        discountPercentage: 100,
      }],
    };
    const point = aaAdapter.computePoint(record, controls)!;
    expect(point.x).toBe(12);
    expect(point.discount).toEqual({
      percentage: 60,
      preDiscountX: 30,
      providerName: "Free input provider",
    });
  });

  it("derives a metadata-only discount from its effective workload cost", () => {
    const record = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      canonicalTokens: { input: 1_000_000, output: 1_000_000 },
      providers: [{
        providerName: "Metadata Provider",
        providerSlug: "metadata",
        effectiveInputPrice: 6,
        effectiveOutputPrice: 12,
        discountPercentage: 40,
      }],
    };
    const point = aaAdapter.computePoint(record, controls)!;
    expect(point.discount).toMatchObject({ percentage: 40, preDiscountX: 30 });
  });

  it("renders every explicit provider discount as a separate annotation", () => {
    const record = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      canonicalTokens: { input: 1_000_000, output: 1_000_000 },
      providers: [
        {
          providerName: "Discount A",
          providerSlug: "discount-a",
          effectiveInputPrice: 1,
          effectiveOutputPrice: 2,
          listedInputPrice: 2,
          listedOutputPrice: 4,
          discountPercentage: 50,
        },
        {
          providerName: "Discount B",
          providerSlug: "discount-b",
          effectiveInputPrice: 3,
          effectiveOutputPrice: 4,
          listedInputPrice: 4,
          listedOutputPrice: 6,
          discountPercentage: 25,
        },
      ],
    };
    const point = aaAdapter.computePoint(record, controls)!;
    expect(point.discounts?.map((discount) => discount.providerName)).toEqual([
      "Discount A",
      "Discount B",
    ]);
    expect(point.discounts?.map((discount) => discount.providerRole)).toEqual([
      "plotted",
      "alternative",
    ]);
    expect(point.discounts?.[1]?.effectiveX).toBe(7);
    expect(point.discounts?.[1]?.plottedProviderName).toBe("Discount A");
  });

  it("draws a model-linked discount against its explicit undiscounted OpenRouter model", () => {
    const record = {
      ...AA_RECORD_PLOTTABLE_CHEAPEST,
      canonicalTokens: { input: 1_000_000, output: 1_000_000 },
      providers: [{
        providerName: "Meta",
        providerSlug: "meta",
        effectiveInputPrice: 0.1,
        effectiveOutputPrice: 0.2,
        listedInputPrice: 1.25,
        listedOutputPrice: 4.25,
        undiscountedModelId: "meta/muse-spark-1.2",
      }],
    };
    const point = aaAdapter.computePoint(record, controls)!;
    expect(point.discounts?.[0]).toMatchObject({
      preDiscountX: 5.5,
      undiscountedModelId: "meta/muse-spark-1.2",
    });
    expect(point.discounts?.[0]?.effectiveX).toBeCloseTo(0.3, 10);
    expect(point.discounts?.[0]?.percentage).toBeCloseTo(94.54545, 4);
  });

  it("does not infer a discount when source metadata is absent", () => {
    const point = aaAdapter.computePoint(AA_RECORD_PLOTTABLE_CHEAPEST, controls)!;
    expect(point.discount).toBeUndefined();
    expect(point.discounts).toEqual([]);
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

  it("treats models with no providers as unplottable in every provider-based mode", () => {
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

  it("exposes no normalized-workload control", () => {
    const ids = aaAdapter.controlSpecs.map((s) => s.id);
    expect(ids).toEqual(["scoreSource", "pricingMode", "cacheHitRate"]);
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
      "This chart uses the latest prices and discounts from OpenRouter to find the real models on the Pareto frontier, updated multiple times per day, as some prices change around weekends and Chinese working hours",
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
