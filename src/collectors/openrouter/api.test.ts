import { describe, expect, it, vi } from "vitest";
import {
  UpstreamError,
  fetchJson,
  isEmptySkeleton,
  mapWithConcurrency,
  rawCatalogResponseSchema,
  rawEffectivePricingResponseSchema,
  resolveCanonicalSlug,
} from "./api";
import catalogFixture from "./fixtures/model-catalog.json";
import emptyPricing from "./fixtures/effective-pricing-empty.json";
import fullPricing from "./fixtures/effective-pricing-full.json";

const FETCH_OPTS = {
  timeoutMs: 1000,
  retries: 2,
  backoffBaseMs: 1,
  fetchImpl: (() => undefined) as unknown as typeof fetch,
  delay: async () => {},
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("raw response parsing", () => {
  it("parses the real effective-pricing response shape with exact numeric preservation", () => {
    const parsed = rawEffectivePricingResponseSchema.parse(fullPricing);
    expect(parsed.data.weightedInputPrice).toBe(1.2714249835324893);
    const first = parsed.data.providerSummaries[0]!;
    expect(first.providerName).toBe("Claude Platform on AWS");
    expect(first.providerSlug).toBe("claude-on-aws");
    expect(first.effectiveInputPrice).toBe(1.205441732165264);
    expect(first.effectiveOutputPrice).toBe(24.9999958112265);
    expect(parsed.data.providerSummaries).toHaveLength(8);
  });

  it("parses the model catalog and maps id -> canonical_slug", () => {
    const parsed = rawCatalogResponseSchema.parse(catalogFixture);
    expect(resolveCanonicalSlug(parsed.data, "anthropic/claude-opus-5")).toBe(
      "anthropic/claude-opus-5-20260723",
    );
    expect(resolveCanonicalSlug(parsed.data, "openai/gpt-5.6-sol")).toBe("openai/gpt-5.6-sol-20260709");
    expect(resolveCanonicalSlug(parsed.data, "not/in-catalog")).toBeUndefined();
  });

  it("detects the empty-skeleton response (short permaslug trap)", () => {
    const parsed = rawEffectivePricingResponseSchema.parse(emptyPricing);
    expect(isEmptySkeleton(parsed.data)).toBe(true);
    expect(isEmptySkeleton(rawEffectivePricingResponseSchema.parse(fullPricing).data)).toBe(false);
  });

  it("treats a real response as non-empty even if one field is zero", () => {
    const almostEmpty = {
      data: {
        weightedInputPrice: 0,
        weightedOutputPrice: 5,
        providerSummaries: [
          { endpointId: "e1", providerName: "x", providerSlug: "x", effectiveInputPrice: 0, effectiveOutputPrice: 5 },
        ],
      },
    };
    expect(isEmptySkeleton(rawEffectivePricingResponseSchema.parse(almostEmpty).data)).toBe(false);
  });
});

describe("fetchJson retry/timeout behavior", () => {
  it("retries 5xx responses with backoff and succeeds", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse(fullPricing));
    const result = await fetchJson("https://test/x", rawEffectivePricingResponseSchema, {
      ...FETCH_OPTS,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.data.providerSummaries).toHaveLength(8);
  });

  it("retries network errors (e.g. timeouts) and succeeds", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("The operation was aborted due to timeout"))
      .mockResolvedValueOnce(jsonResponse(fullPricing));
    const result = await fetchJson("https://test/x", rawEffectivePricingResponseSchema, {
      ...FETCH_OPTS,
      fetchImpl,
    });
    expect(result.data.weightedInputPrice).toBeGreaterThan(0);
  });

  it("throws UpstreamError after exhausting retries", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 503));
    await expect(
      fetchJson("https://test/x", rawEffectivePricingResponseSchema, { ...FETCH_OPTS, fetchImpl }),
    ).rejects.toThrow(UpstreamError);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("does not retry non-retryable 4xx statuses", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 404));
    await expect(
      fetchJson("https://test/x", rawEffectivePricingResponseSchema, { ...FETCH_OPTS, fetchImpl }),
    ).rejects.toThrow(/404/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed on unexpected payload shapes instead of persisting garbage", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({ unexpected: true }));
    await expect(
      fetchJson("https://test/x", rawEffectivePricingResponseSchema, { ...FETCH_OPTS, fetchImpl }),
    ).rejects.toThrow(/unexpected payload shape/);
  });
});

describe("mapWithConcurrency", () => {
  it("never exceeds the concurrency limit and preserves result order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 2, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return n * 10;
    });
    expect(result).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("rejects non-positive limits", async () => {
    await expect(mapWithConcurrency([1], 0, async (n) => n)).rejects.toThrow(RangeError);
  });
});
