import { describe, expect, it } from "vitest";
import {
  CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS,
  derivedAaDatasetSchema,
  derivedCursorDatasetSchema,
  type DerivedAaChartRecord,
  type DerivedCursorChartRecord,
  type FreshnessMetadata,
} from "./derived";
import { SCHEMA_VERSIONS } from "./version";
import { validOpenRouterPricing, validCursorRecord } from "./fixtures/openrouter-cursor";
import { validAaModel } from "./fixtures/aa";

const freshness: FreshnessMetadata = {
  schemaVersion: SCHEMA_VERSIONS.derived,
  deepsweObservedAt: "2026-08-20T20:00:00.000Z",
  asOf: "2026-08-21T00:00:00.000Z",
  aaObservedAt: "2026-08-20T22:00:00.000Z",
  openrouterObservedAt: "2026-08-20T23:00:00.000Z",
  cursorObservedAt: "2026-08-19T12:00:00.000Z",
};

const aaRecord: DerivedAaChartRecord = {
  slug: validAaModel.slug,
  name: validAaModel.name,
  shortName: validAaModel.shortName,
  intelligenceIndex: validAaModel.intelligenceIndex,
  scoreSources: { artificialAnalysis: validAaModel.intelligenceIndex },
  canonicalTokens: {
    input: validAaModel.canonicalIntelligenceIndexTokenCount.input,
    output: validAaModel.canonicalIntelligenceIndexTokenCount.output,
  },
  providers: validOpenRouterPricing.providerSummaries,
  weighted: {
    weightedInputPrice: validOpenRouterPricing.weightedInputPrice,
    weightedOutputPrice: validOpenRouterPricing.weightedOutputPrice,
  },
  listed: {
    price1mInputTokens: validAaModel.price1mInputTokens,
    price1mOutputTokens: validAaModel.price1mOutputTokens,
    cacheHitPrice: validAaModel.cacheHitPrice,
  },
};

const cursorRecord: DerivedCursorChartRecord = {
  modelId: validCursorRecord.modelId,
  modelName: validCursorRecord.modelName,
  provider: validCursorRecord.provider,
  isThirdParty: validCursorRecord.isThirdParty,
  score: validCursorRecord.score,
  inputTokens: validCursorRecord.inputTokens,
  outputTokens: validCursorRecord.outputTokens,
};

describe("derived datasets", () => {
  it("accepts a valid AA dataset", () => {
    const parsed = derivedAaDatasetSchema.parse({ freshness, records: [aaRecord] });
    expect(parsed.records[0]?.providers).toHaveLength(2);
  });

  it("accepts a valid Cursor dataset", () => {
    expect(derivedCursorDatasetSchema.parse({ freshness, records: [cursorRecord] }).records).toHaveLength(1);
  });

  it("accepts an AA record with an empty providers array (unplottable: no pricing known)", () => {
    expect(
      derivedAaDatasetSchema.safeParse({ freshness, records: [{ ...aaRecord, providers: [] }] })
        .success,
    ).toBe(true);
  });

  it("rejects non-array providers", () => {
    expect(
      derivedAaDatasetSchema.safeParse({ freshness, records: [{ ...aaRecord, providers: "none" }] })
        .success,
    ).toBe(false);
  });

  it("rejects mismatched freshness schema versions", () => {
    expect(
      derivedAaDatasetSchema.safeParse({
        freshness: { ...freshness, schemaVersion: 99 },
        records: [aaRecord],
      }).success,
    ).toBe(false);
  });

  it("exposes the Cursor surcharge as a shared constant", () => {
    expect(CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS).toBe(0.25);
  });
});
