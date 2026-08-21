import { describe, expect, it } from "vitest";
import { isoUtcTimestamp } from "./primitives";
import {
  openRouterModelPricingSchema,
  openRouterSnapshotPayloadSchema,
} from "./openrouter";
import {
  invalidOpenRouterNoProviders,
  validOpenRouterPricing,
  validOpenRouterPricing2,
} from "./fixtures/openrouter-cursor";

const VALID_OBSERVED_AT = "2026-08-21T01:53:42.000Z";
const SOURCE = { source: "openrouter" as const, endpointUrl: "https://openrouter.ai/api/frontend/v1/stats/effective-pricing", mappingRef: "mappings/openrouter-aliases.json" };

describe("openRouterModelPricingSchema", () => {
  it("accepts a representative valid record with provider summaries", () => {
    const parsed = openRouterModelPricingSchema.parse(validOpenRouterPricing);
    expect(parsed.providerSummaries).toHaveLength(2);
    expect(parsed.weightedInputPrice).toBe(4.75);
    expect(parsed.providerSummaries[1]?.providerSlug).toBe("chutes");
  });

  it("rejects an empty providerSummaries array", () => {
    expect(openRouterModelPricingSchema.safeParse(invalidOpenRouterNoProviders).success).toBe(
      false,
    );
  });

  it("rejects missing AA linkage fields", () => {
    const { aaModelSlug, ...broken } = validOpenRouterPricing;
    expect(openRouterModelPricingSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects non-numeric prices", () => {
    expect(
      openRouterModelPricingSchema.safeParse({
        ...validOpenRouterPricing,
        effectiveInputPrice: "5",
        providerSummaries: [
          { providerName: "x", providerSlug: "x", effectiveInputPrice: "5", effectiveOutputPrice: 1 },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("openRouterSnapshotPayloadSchema", () => {
  it("accepts a valid payload", () => {
    expect(
      openRouterSnapshotPayloadSchema.parse({
        observedAt: VALID_OBSERVED_AT,
        source: SOURCE,
        records: [validOpenRouterPricing, validOpenRouterPricing2],
      }).records,
    ).toHaveLength(2);
  });

  it("rejects duplicate aaModelSlug entries", () => {
    const duplicate = { ...validOpenRouterPricing2, aaModelSlug: "claude-opus-5" };
    expect(
      openRouterSnapshotPayloadSchema.safeParse({
        observedAt: VALID_OBSERVED_AT,
        source: SOURCE,
        records: [validOpenRouterPricing, duplicate],
      }).success,
    ).toBe(false);
  });

  it("rejects non-UTC observedAt timestamps", () => {
    expect(
      openRouterSnapshotPayloadSchema.safeParse({
        observedAt: "2026-08-21T01:53:42+02:00",
        source: SOURCE,
        records: [validOpenRouterPricing],
      }).success,
    ).toBe(false);
    expect(isoUtcTimestamp.safeParse("not-a-timestamp").success).toBe(false);
  });
});
