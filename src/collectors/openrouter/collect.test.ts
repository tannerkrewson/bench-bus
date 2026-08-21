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
    "deepseek-v4-pro-20260423": fullPricing,
    "qwen3.8-max-20260803": fullPricing,
    "nemotron-3-super-120b-a12b-20230311": fullPricing,
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
    "glm-5.3-20260816": fullPricing,
    "kimi-k3-20260715": fullPricing,
    "grok-4.6-20260810": fullPricing,
    "deepseek-v4-pro-20260423": fullPricing,
    "qwen3.8-max-20260803": fullPricing,
    "nemotron-3-super-120b-a12b-20230311": fullPricing,
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
      "deepseek-v4-pro-20260423": fullPricing,
      "qwen3.8-max-20260803": fullPricing,
      "nemotron-3-super-120b-a12b-20230311": fullPricing,
    }));
    await collectOpenRouterPricing(baseOptions({ fetchImpl, retries: 1 }));
    const pricingCalls = fetchImpl.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("effective-pricing"));
    expect(pricingCalls.length).toBe(aliasSeed.entries.length);
    // The short-slug trap: every pricing call must use a date-suffixed canonical slug.
    for (const url of pricingCalls) {
      expect(url).toMatch(/permaslug=[^&]*-\d{8}&shape=v7&variant=standard/);
    }
  });

  it("fails closed on an empty-skeleton response: no records persisted, error thrown", async () => {
    const report = await collectOpenRouterPricing(optionsWithGeminiEmpty()).catch((e: unknown) => {
      expect(e).toBeInstanceOf(CollectorError);
      return (e as CollectorError).report;
    });
    const geminiFailure = report.failures.find((f) => f.aaModelSlug === "gemini-3.7-flash");
    expect(geminiFailure?.category).toBe("no-data");
    expect(report.records.find((r) => r.aaModelSlug === "gemini-3.7-flash")).toBeUndefined();
  });

  it("surfaces provisional aliases and mapping suggestions in the report without acting on them", async () => {
    const report = await collectOpenRouterPricing(baseOptions());
    expect(report.provisionalUsed).toContain("grok-4.6");
    expect(report.suggestedObvious).toEqual([]); // every seed slug already has a mapping entry
    // Advisory suggestions never leak into records.
    const slugs = report.records.map((r) => r.aaModelSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
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
      "deepseek-v4-pro-20260423": fullPricing,
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
    try {
      await collectOpenRouterPricing(optionsWithGeminiEmpty());
      expect.unreachable("expected CollectorError");
    } catch (error) {
      const text = formatReport((error as CollectorError).report);
      expect(text).toContain("PROVISIONAL aliases used");
      expect(text).toContain("FAILURE [no-data] gemini-3.7-flash");
    }
  });
});
