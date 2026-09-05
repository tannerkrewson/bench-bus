import { describe, expect, it, vi } from "vitest";
import { openRouterSnapshotPayloadSchema } from "../../schemas/openrouter";
import {
  CollectorError,
  collectOpenRouterPricing,
  formatReport,
  writeSnapshotPayload,
  type CollectorIo,
} from "./collect";
import catalogFixture from "./fixtures/model-catalog.json";
import emptyPricing from "./fixtures/effective-pricing-empty.json";
import fullPricing from "./fixtures/effective-pricing-full.json";
import aliasSeed from "./openrouter-aliases.json";

const OBSERVED_AT = "2026-08-21T12:00:00.000Z";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Route mocked fetches by URL substring. */
function routerFetch(routes: Record<string, unknown | (() => Response)>): typeof fetch {
  return ((input: string | URL | Request) => {
    const url = String(input);
    for (const [fragment, body] of Object.entries(routes)) {
      if (url.includes(fragment)) {
        return Promise.resolve(typeof body === "function" ? (body as () => Response)() : jsonResponse(body));
      }
    }
    if (
      url.includes("gpt-6-astra-20260903") ||
      url.includes("gpt-5.6-luna-20260709") ||
      url.includes("muse-spark-1.2-contributor-20260805") ||
      url.includes("glm-5.3-flash-20260826") ||
      url.includes("qwen3.8-flash-20260826") ||
      url.includes("mimo-v2.5-20260422") ||
      url.includes("glm-5.2-20260616") ||
      url.includes("deepseek-v4-flash-20260423") ||
      url.includes("deepseek-v4-pro-20260423") ||
      url.includes("hy3-20260706") ||
      url.includes("claude-4.7-opus-20260416") ||
      url.includes("claude-4.8-opus-20260528") ||
      url.includes("gemini-3.1-pro-preview-20260219") ||
      url.includes("gemini-3.5-flash-20260519") ||
      url.includes("glm-5.1-20260406") ||
      url.includes("gpt-5.4-20260305") ||
      url.includes("gpt-5.4-mini-20260317") ||
      url.includes("gpt-5.5-20260423") ||
      url.includes("kimi-k2.6-20260420") ||
      url.includes("mimo-v2.5-pro-20260422") ||
      url.includes("minimax-m2.7-20260318") ||
      url.includes("minimax-m3-20260531") ||
      url.includes("qwen3.6-plus-04-02") ||
      url.includes("qwen3.7-max-20260520")
    ) {
      return Promise.resolve(jsonResponse(fullPricing));
    }
    return Promise.resolve(jsonResponse({}, 404));
  }) as typeof fetch;
}

function memoryIo(files: Map<string, string>): CollectorIo {
  return {
    readFile: async (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    writeFile: async (path, data) => void files.set(path, data),
    rename: async (from, to) => {
      const content = files.get(from);
      if (content === undefined) throw new Error(`ENOENT: ${from}`);
      files.delete(from);
      files.set(to, content);
    },
    mkdir: async () => undefined,
  };
}

const ALIAS_PATH = "test-aliases.json";
const baseFiles = () => new Map([[ALIAS_PATH, JSON.stringify(aliasSeed)]]);
const baseOptions = (overrides: Partial<Parameters<typeof collectOpenRouterPricing>[0]> = {}) => ({
  aliasPath: ALIAS_PATH,
  concurrency: 4,
  timeoutMs: 500,
  retries: 0,
  backoffBaseMs: 1,
  now: () => new Date(OBSERVED_AT),
  io: memoryIo(baseFiles()),
  fetchImpl: routerFetch({
    "api/v1/models": catalogFixture,
    "claude-opus-5-20260723": fullPricing,
    "claude-sonnet-5-20260630": fullPricing,
    "gpt-5.6-sol-20260709": fullPricing,
    "gemini-3.7-flash-20260813": fullPricing,
    "glm-5.3-20260816": fullPricing,
    "kimi-k3-20260715": fullPricing,
    "grok-4.6-20260810": fullPricing,
    "deepseek-v4-pro-20260813": fullPricing,
    "qwen3.8-max-20260803": fullPricing,
    "nemotron-3-super-120b-a12b-20230311": fullPricing,
    "qwen3.8-flash-20260826": fullPricing,
    "mimo-v2.5-20260422": fullPricing,
    "glm-5.2-20260616": fullPricing,
    "deepseek-v4-flash-20260423": fullPricing,
    "deepseek-v4-pro-20260423": fullPricing,
    "hy3-20260706": fullPricing,
  }),
  ...overrides,
});

/** baseOptions but with gemini returning the empty skeleton (no-data case). */
const optionsWithGeminiEmpty = (overrides: Partial<Parameters<typeof collectOpenRouterPricing>[0]> = {}) => {
  const options = baseOptions(overrides);
  return { ...options, fetchImpl: routerFetch({ ...routesFor(options.fetchImpl), "gemini-3.7-flash-20260813": emptyPricing }) };
};

function routesFor(_fetchImpl: unknown): Record<string, unknown> {
  return {
    "api/v1/models": catalogFixture,
    "claude-opus-5-20260723": fullPricing,
    "claude-sonnet-5-20260630": fullPricing,
    "gpt-5.6-sol-20260709": fullPricing,
    "gemini-3.7-flash-20260813": fullPricing,
    "glm-5.3-20260816": fullPricing,
    "kimi-k3-20260715": fullPricing,
    "grok-4.6-20260810": fullPricing,
    "deepseek-v4-pro-20260813": fullPricing,
    "qwen3.8-max-20260803": fullPricing,
    "nemotron-3-super-120b-a12b-20230311": fullPricing,
    "qwen3.8-flash-20260826": fullPricing,
    "mimo-v2.5-20260422": fullPricing,
    "glm-5.2-20260616": fullPricing,
    "deepseek-v4-flash-20260423": fullPricing,
    "deepseek-v4-pro-20260423": fullPricing,
    "hy3-20260706": fullPricing,
  };
}

describe("collectOpenRouterPricing", () => {
  it("collects all mapped models into a schema-valid snapshot payload", async () => {
    const report = await collectOpenRouterPricing(baseOptions());
    expect(report.records).toHaveLength(aliasSeed.entries.length);
    expect(report.failures).toEqual([]);
    expect(report.observedAt).toBe(OBSERVED_AT);
    const payload = openRouterSnapshotPayloadSchema.parse({
      observedAt: report.observedAt,
      source: {
        source: "openrouter",
        endpointUrl: "https://openrouter.ai/api/frontend/v1/stats/effective-pricing",
        mappingRef: report.mappingRef,
      },
      records: report.records,
    });
    expect(payload.records[0]?.providerSummaries.length).toBeGreaterThan(0);
  });

  it("preserves the explicit undiscounted model for contributor pricing", async () => {
    const report = await collectOpenRouterPricing(baseOptions());
    const muse = report.records.find((record) => record.aaModelSlug === "muse-spark-1-2");
    expect(muse).toMatchObject({
      permaslug: "meta/muse-spark-1.2-contributor",
      providerSummaries: expect.arrayContaining([expect.objectContaining({
        listedInputPrice: 1.25,
        listedOutputPrice: 4.25,
        undiscountedModelId: "meta/muse-spark-1.2",
      })]),
    });
  });

  it("does not report a frontier alias as unmatched when it shares a base-model id", async () => {
    const report = await collectOpenRouterPricing(baseOptions({
      frontierModels: [{ slug: "claude-opus-5-high", id: "aa-opus-high" }],
    }));
    expect(report.records.map((record) => record.aaModelSlug)).toContain("claude-opus-5-high");
    expect(report.unmatchedFrontierModels).not.toContain("claude-opus-5-high");
  });

  it("automatically carries contributor pricing for a newly discovered frontier model", async () => {
    const catalogWithMuse13 = {
      ...catalogFixture,
      data: [
        ...catalogFixture.data,
        {
          id: "meta/muse-spark-1.3",
          canonical_slug: "meta/muse-spark-1.3-20260902",
          name: "Meta: Muse Spark 1.3",
          pricing: {
            prompt: "0.00000125",
            completion: "0.00000425",
            input_cache_read: "0.00000015",
          },
        },
        {
          id: "meta/muse-spark-1.3-contributor",
          canonical_slug: "meta/muse-spark-1.3-contributor-20260902",
          name: "Meta: Muse Spark 1.3 Contributor",
          pricing: { prompt: "0.0000001", completion: "0.0000002" },
        },
      ],
    };
    const fallback = baseOptions().fetchImpl!;
    const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api/v1/models")) return Promise.resolve(jsonResponse(catalogWithMuse13));
      if (url.includes("muse-spark-1.3-contributor-20260902")) return Promise.resolve(jsonResponse(fullPricing));
      return fallback(input, init);
    }) as typeof fetch;

    const report = await collectOpenRouterPricing(baseOptions({
      frontierModels: [{ slug: "muse-spark-1-3-xhigh", id: "aa-muse-1-3" }],
      fetchImpl,
    }));
    const muse = report.records.find((record) => record.aaModelSlug === "muse-spark-1-3-xhigh");
    expect(muse).toMatchObject({
      permaslug: "meta/muse-spark-1.3-contributor",
      providerSummaries: expect.arrayContaining([expect.objectContaining({
        listedInputPrice: 1.25,
        listedOutputPrice: 4.25,
        undiscountedModelId: "meta/muse-spark-1.3",
      })]),
    });
  });

  it("collects Sol effort variants against the shared base OpenRouter identity", async () => {
    const report = await collectOpenRouterPricing(baseOptions());
    for (const slug of ["gpt-5-6-sol-low", "gpt-5-6-sol-medium"]) {
      expect(report.records.find((record) => record.aaModelSlug === slug)).toMatchObject({
        permaslug: "openai/gpt-5.6-sol",
      });
    }
  });

  it("collects Grok 4.6 high and medium against one family identity", async () => {
    const report = await collectOpenRouterPricing(baseOptions());
    for (const slug of ["grok-4-6", "grok-4-6-medium"]) {
      expect(report.records.find((record) => record.aaModelSlug === slug)).toMatchObject({
        permaslug: "x-ai/grok-4.6",
      });
    }
  });

  it("looks up frontier and forced curated identities before unmatched models are discarded", async () => {
    const catalogWithExtras = {
      ...catalogFixture,
      data: [
        ...catalogFixture.data,
        {
          id: "vendor/frontier-model",
          canonical_slug: "vendor/frontier-model-20260821",
          name: "Frontier Model",
        },
        {
          id: "deepseek/deepseek-v4-flash-0731",
          canonical_slug: "deepseek/deepseek-v4-flash-20260731",
          name: "DeepSeek V4 0731 Flash",
        },
      ],
    };
    const report = await collectOpenRouterPricing(baseOptions({
      frontierModels: [{ slug: "frontier-model", id: "aa-frontier" }],
      curatedModels: [{
        aaModelSlug: "deepseek-v4-flash",
        aaModelId: "fe4c0848-e284-4e52-a79d-cdc28392f1a9",
        openrouterId: "deepseek/deepseek-v4-flash-0731",
      }],
      fetchImpl: routerFetch({
        "api/v1/models": catalogWithExtras,
        "frontier-model-20260821": fullPricing,
        "deepseek-v4-flash-20260731": fullPricing,
        "claude-opus-5-20260723": fullPricing,
        "claude-sonnet-5-20260630": fullPricing,
        "gpt-5.6-sol-20260709": fullPricing,
        "gemini-3.7-flash-20260813": fullPricing,
        "glm-5.3-20260816": fullPricing,
        "kimi-k3-20260715": fullPricing,
        "grok-4.6-20260810": fullPricing,
        "deepseek-v4-pro-20260813": fullPricing,
        "qwen3.8-max-20260803": fullPricing,
        "nemotron-3-super-120b-a12b-20230311": fullPricing,
      }),
    }));
    expect(report.records.map((record) => record.aaModelSlug)).toContain("frontier-model");
    expect(report.records.map((record) => record.aaModelSlug)).toContain("deepseek-v4-flash");
    expect(report.unmatchedFrontierModels).toEqual([]);
  });

  it("reports curated identities missing from the current catalog without fabricating records", async () => {
    const report = await collectOpenRouterPricing(baseOptions({
      curatedModels: [{
        aaModelSlug: "missing-curated-model",
        aaModelId: "missing-curated-model",
        openrouterId: "missing/vendor-model",
      }],
    }));

    expect(report.unmatchedCuratedModels).toEqual(["missing-curated-model"]);
    expect(report.records.map((record) => record.aaModelSlug)).not.toContain("missing-curated-model");
    expect(formatReport(report)).toContain(
      "unmatched curated OpenRouter models: missing-curated-model",
    );
  });

  it("preserves catalog listed prices and explicit effective-provider discount metadata", async () => {
    const catalogWithPricing = {
      ...catalogFixture,
      data: catalogFixture.data.map((model) =>
        model.id === "anthropic/claude-opus-5"
          ? {
              ...model,
              pricing: {
                prompt: "0.00001",
                completion: "0.00002",
                input_cache_read: "0.000001",
                input_cache_write: "0.00003",
              },
            }
          : model,
      ),
    };
    const effectiveWithDiscount = {
      ...fullPricing,
      data: {
        ...fullPricing.data,
        providerSummaries: fullPricing.data.providerSummaries.map((provider, index) =>
          index === 0
            ? {
                ...provider,
                listedInputPrice: 1.5,
                listedOutputPrice: 30,
                discountPercentage: 20,
              }
            : provider,
        ),
      },
    };
    const report = await collectOpenRouterPricing(baseOptions({
      fetchImpl: routerFetch({
        "api/v1/models": catalogWithPricing,
        "claude-opus-5-20260723": effectiveWithDiscount,
        "claude-sonnet-5-20260630": fullPricing,
        "gpt-5.6-sol-20260709": fullPricing,
        "gemini-3.7-flash-20260813": fullPricing,
        "glm-5.3-20260816": fullPricing,
        "kimi-k3-20260715": fullPricing,
        "grok-4.6-20260810": fullPricing,
        "deepseek-v4-pro-20260813": fullPricing,
        "qwen3.8-max-20260803": fullPricing,
        "nemotron-3-super-120b-a12b-20230311": fullPricing,
      }),
    }));
    const claude = report.records.find((record) => record.aaModelSlug === "claude-opus-5")!;
    expect(claude.listedInputPrice).toBe(10);
    expect(claude.listedOutputPrice).toBe(20);
    expect(claude.listedCacheReadPrice).toBe(1);
    expect(claude.providerSummaries[0]?.discountPercentage).toBe(20);
    expect(claude.providerSummaries[0]?.listedInputPrice).toBe(1.5);
  });

  it("uses effective-row prices before page-derived prices before catalog fallbacks", async () => {
    const effectiveWithDirectPrices = {
      ...fullPricing,
      data: {
        ...fullPricing.data,
        providerSummaries: fullPricing.data.providerSummaries.map((provider, index) =>
          index === 0
            ? {
                ...provider,
                listedInputPrice: 1.5,
                listedOutputPrice: 30,
              }
            : provider,
        ),
      },
    };
    const page = `<script>self.__next_f.push([1,"4:{\\"provider_name\\":\\"Claude Platform on AWS\\",\\"provider_slug\\":\\"claude-on-aws/fp8\\",\\"pricing\\":{\\"prompt\\":\\"0.0000008\\",\\"completion\\":\\"0.000016\\",\\"discount\\":0.2}}"])</script>`;
    const fallback = baseOptions().fetchImpl!;
    const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://openrouter.ai/anthropic/claude-opus-5") {
        return Promise.resolve(new Response(page, { status: 200, headers: { "content-type": "text/html" } }));
      }
      if (url.includes("claude-opus-5-20260723")) {
        return Promise.resolve(jsonResponse(effectiveWithDirectPrices));
      }
      return fallback(input, init);
    }) as typeof fetch;
    const report = await collectOpenRouterPricing(baseOptions({
      collectProviderDiscounts: true,
      fetchImpl,
    }));
    const claude = report.records.find((record) => record.aaModelSlug === "claude-opus-5")!;
    expect(claude.providerSummaries[0]).toMatchObject({
      listedInputPrice: 1.5,
      listedOutputPrice: 30,
      discountPercentage: 20,
    });
  });

  it("joins page service tiers to effective providers by endpoint id", async () => {
    const endpointId = fullPricing.data.providerSummaries[0]!.endpointId;
    const page = `<script>self.__next_f.push([1,"4:{\\"id\\":\\"${endpointId}\\",\\"name\\":\\"Provider | anthropic/model-20260723\\",\\"provider_name\\":\\"Claude Platform on AWS\\",\\"provider_slug\\":\\"claude-on-aws\\",\\"service_tier\\":\\"flex\\",\\"pricing\\":{\\"prompt\\":\\"0.000001\\",\\"completion\\":\\"0.00001\\",\\"discount\\":0}}"])</script>`;
    const fallback = baseOptions().fetchImpl!;
    const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://openrouter.ai/anthropic/claude-opus-5") {
        return Promise.resolve(new Response(page, { status: 200, headers: { "content-type": "text/html" } }));
      }
      return fallback(input, init);
    }) as typeof fetch;
    const report = await collectOpenRouterPricing(baseOptions({ collectProviderDiscounts: true, fetchImpl }));
    const claude = report.records.find((record) => record.aaModelSlug === "claude-opus-5")!;
    expect(claude.providerSummaries[0]?.serviceTier).toBe("flex");
  });

  it("resolves canonical date-suffixed slugs before querying effective pricing", async () => {
    const fetchImpl = vi.fn(routerFetch({
      "api/v1/models": catalogFixture,
      "claude-opus-5-20260723": fullPricing,
      "claude-sonnet-5-20260630": fullPricing,
      "gpt-5.6-sol-20260709": fullPricing,
      "gemini-3.7-flash-20260813": fullPricing,
      "glm-5.3-20260816": fullPricing,
      "kimi-k3-20260715": fullPricing,
      "grok-4.6-20260810": fullPricing,
      "deepseek-v4-pro-20260813": fullPricing,
      "qwen3.8-max-20260803": fullPricing,
      "nemotron-3-super-120b-a12b-20230311": fullPricing,
    }));
    await collectOpenRouterPricing(baseOptions({ fetchImpl, retries: 1 }));
    const pricingCalls = fetchImpl.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("effective-pricing"));
    expect(pricingCalls.length).toBe(aliasSeed.entries.length);
    // The short-slug trap: every pricing call must use a canonical release
    // suffix, never the stable id without its upstream-resolved suffix.
    for (const url of pricingCalls) {
      // OpenRouter normally uses YYYYMMDD, but some canonical slugs use the
      // model's MM-DD release form (for example qwen3.6-plus-04-02).
      expect(url).toMatch(/permaslug=[^&]*(?:-\d{8}|-\d{2}-\d{2})&shape=v7&variant=standard/);
    }
  });

  it("follows a release-suffixed replacement when OpenRouter retires a stable id", async () => {
    const catalogWithReplacement = {
      ...catalogFixture,
      data: catalogFixture.data.map((model) =>
        model.id === "qwen/qwen3.8-max"
          ? { ...model, id: "qwen/qwen3.8-max-0902", canonical_slug: "qwen/qwen3.8-max-20260902" }
          : model,
      ),
    };
    const report = await collectOpenRouterPricing(
      baseOptions({
        fetchImpl: routerFetch({
          ...routesFor(baseOptions().fetchImpl),
          "api/v1/models": catalogWithReplacement,
          "qwen3.8-max-20260902": fullPricing,
        }),
      }),
    );
    expect(report.records.find((record) => record.aaModelSlug === "qwen3-8-max")?.permaslug)
      .toBe("qwen/qwen3.8-max");
  });

  it("fails closed on an empty-skeleton response: no records persisted, error thrown", async () => {
    const report = await collectOpenRouterPricing(optionsWithGeminiEmpty()).catch((e: unknown) => {
      expect(e).toBeInstanceOf(CollectorError);
      return (e as CollectorError).report;
    });
    const geminiFailure = report.failures.find((f) => f.aaModelSlug === "gemini-3-7-flash");
    expect(geminiFailure?.category).toBe("no-data");
    expect(report.records.find((r) => r.aaModelSlug === "gemini-3-7-flash")).toBeUndefined();
  });

  it("surfaces provisional aliases and mapping suggestions in the report without acting on them", async () => {
    // The curated seed file has no provisional entries left.
    const report = await collectOpenRouterPricing(baseOptions());
    expect(report.provisionalUsed).toEqual([]);
    expect(report.suggestedObvious).toEqual([]); // every seed slug already has a mapping entry
    // Advisory suggestions never leak into records.
    const slugs = report.records.map((r) => r.aaModelSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("still surfaces provisional aliases when one is reintroduced", async () => {
    const provisionalSeed = {
      ...aliasSeed,
      entries: aliasSeed.entries.map((e) =>
        e.aaModelSlug === "grok-4-6" ? { ...e, status: "provisional" as const } : e,
      ),
    };
    const files = baseFiles();
    files.set(ALIAS_PATH, JSON.stringify(provisionalSeed));
    const report = await collectOpenRouterPricing(baseOptions({ io: memoryIo(files) }));
    expect(report.provisionalUsed).toContain("grok-4-6");
  });

  it("fails closed when an OpenRouter id cannot be resolved in the catalog", async () => {
    const brokenSeed = {
      ...aliasSeed,
      entries: [
        ...aliasSeed.entries,
        {
          aaModelSlug: "phantom-model",
          aaModelId: "phantom-model",
          openrouterId: "phantom/phantom-model",
          status: "confirmed",
        },
      ],
    };
    const files = baseFiles();
    files.set(ALIAS_PATH, JSON.stringify(brokenSeed));
    await expect(
      collectOpenRouterPricing(baseOptions({ io: memoryIo(files) })),
    ).rejects.toThrow(/phantom-model/);
  });

  it("never writes output when any model fails (partial snapshot impossible)", async () => {
    const files = baseFiles();
    const routes = {
      "api/v1/models": catalogFixture,
      "claude-opus-5-20260723": () => jsonResponse({}, 500),
      "claude-sonnet-5-20260630": fullPricing,
      "gpt-5.6-sol-20260709": fullPricing,
      "gemini-3.7-flash-20260813": fullPricing,
      "glm-5.3-20260816": fullPricing,
      "kimi-k3-20260715": fullPricing,
      "grok-4.6-20260810": fullPricing,
      "deepseek-v4-pro-20260813": fullPricing,
      "qwen3.8-max-20260803": fullPricing,
      "nemotron-3-super-120b-a12b-20230311": fullPricing,
    };
    await expect(
      collectOpenRouterPricing(baseOptions({ io: memoryIo(files), fetchImpl: routerFetch(routes) })),
    ).rejects.toBeInstanceOf(CollectorError);
    expect([...files.keys()].filter((k) => k !== ALIAS_PATH)).toEqual([]);
  });

  it("produces byte-identical serialized output for identical upstream data", async () => {
    const filesA = baseFiles();
    const filesB = baseFiles();
    const reportA = await collectOpenRouterPricing(baseOptions({ io: memoryIo(filesA) }));
    const reportB = await collectOpenRouterPricing(baseOptions({ io: memoryIo(filesB) }));
    await writeSnapshotPayload(reportA, "out/snapshot.json", memoryIo(filesA));
    await writeSnapshotPayload(reportB, "out/snapshot.json", memoryIo(filesB));
    expect(filesA.get("out/snapshot.json")).toBe(filesB.get("out/snapshot.json"));
    const serialized = filesA.get("out/snapshot.json")!;
    expect(serialized.startsWith("{\n  \"observedAt\":")).toBe(true);
    // Records are sorted by aaModelSlug for deterministic diffs.
    const recordSlugs = (JSON.parse(serialized) as { records: { aaModelSlug: string }[] }).records.map(
      (r) => r.aaModelSlug,
    );
    expect(recordSlugs).toEqual([...recordSlugs].sort());
  });

  it("formats a human-readable report with provisional warnings and failures", async () => {
    const provisionalSeed = {
      ...aliasSeed,
      entries: aliasSeed.entries.map((e) =>
        e.aaModelSlug === "grok-4-6" ? { ...e, status: "provisional" as const } : e,
      ),
    };
    const files = baseFiles();
    files.set(ALIAS_PATH, JSON.stringify(provisionalSeed));
    try {
      await collectOpenRouterPricing(
        optionsWithGeminiEmpty({ io: memoryIo(files) }),
      );
      expect.unreachable("expected CollectorError");
    } catch (error) {
      const text = formatReport((error as CollectorError).report);
      expect(text).toContain("PROVISIONAL aliases used");
      expect(text).toContain("FAILURE [no-data] gemini-3-7-flash");
    }
  });
});
