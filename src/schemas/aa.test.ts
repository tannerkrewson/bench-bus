import { describe, expect, it } from "vitest";
import {
  aaModelIdentityKey,
  artificialAnalysisModelSchema,
  validateAaModelCollection,
} from "./aa";
import {
  invalidAaModelMissingField,
  invalidAaModelNonFinite,
  invalidAaModelTokenMismatch,
  validAaModel,
  validAaModel2,
} from "./fixtures/aa";

describe("artificialAnalysisModelSchema", () => {
  it("accepts a representative valid record unchanged", () => {
    const parsed = artificialAnalysisModelSchema.parse(validAaModel);
    // Numeric values round-trip exactly, no rounding or transformation.
    expect(parsed.canonicalIntelligenceIndexTokenCount.output).toBe(45_000);
    expect(parsed.price1mInputTokens).toBe(5);
    expect(parsed.intelligenceIndexCost.total).toBe(12.34);
    expect(parsed.cacheWritePrice).toBe(6.25);
  });

  it("preserves non-round numbers exactly", () => {
    const parsed = artificialAnalysisModelSchema.parse(validAaModel2);
    expect(parsed.canonicalIntelligenceIndexTokenCount.output).toBe(50_000.5);
    expect(parsed.canonicalIntelligenceIndexTokenCount.answer).toBe(30_000.25);
  });

  it("rejects output != answer + reasoning", () => {
    expect(
      artificialAnalysisModelSchema.safeParse(invalidAaModelTokenMismatch).success,
    ).toBe(false);
  });

  it("rejects incomplete records (missing cacheHitPrice)", () => {
    const result = artificialAnalysisModelSchema.safeParse(invalidAaModelMissingField);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("cacheHitPrice"))).toBe(true);
    }
  });

  it("rejects non-finite numeric values", () => {
    expect(artificialAnalysisModelSchema.safeParse(invalidAaModelNonFinite).success).toBe(
      false,
    );
  });

  it("rejects unknown extra fields (strict)", () => {
    expect(
      artificialAnalysisModelSchema.safeParse({ ...validAaModel, surpriseField: 1 })
        .success,
    ).toBe(false);
  });

  it("rejects garbage input", () => {
    expect(artificialAnalysisModelSchema.safeParse(null).success).toBe(false);
    expect(artificialAnalysisModelSchema.safeParse("claude").success).toBe(false);
  });
});

describe("validateAaModelCollection", () => {
  it("accepts distinct valid models and returns them sorted by slug", () => {
    const sorted = validateAaModelCollection([validAaModel2, validAaModel]);
    expect(sorted.map(aaModelIdentityKey)).toEqual(["claude-opus-5", "gpt-6"]);
  });

  it("rejects duplicate identity keys", () => {
    const duplicate = { ...validAaModel, id: "duplicate-id" };
    expect(() => validateAaModelCollection([validAaModel, duplicate])).toThrow(
      /Duplicate Artificial Analysis model identity "claude-opus-5"/,
    );
  });

  it("rejects a collection containing any invalid record", () => {
    expect(() =>
      validateAaModelCollection([validAaModel, invalidAaModelTokenMismatch]),
    ).toThrow(/Invalid Artificial Analysis model record at index 1/);
  });

  it("rejects non-array input", () => {
    expect(() => validateAaModelCollection({ not: "an array" })).toThrow(TypeError);
  });
});
