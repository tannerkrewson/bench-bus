import { describe, expect, it } from "vitest";
import { cursorSnapshotPayloadSchema, validateCursorEvalCollection } from "./cursor";
import {
  invalidCursorMissingProvider,
  invalidCursorScoreOutOfRange,
  validCursorRecord,
  validCursorRecord2,
} from "./fixtures/openrouter-cursor";

const VALID_OBSERVED_AT = "2026-08-21T02:10:00.000Z";
const SOURCE = { source: "cursor" as const, pageUrl: "https://cursor.com/evals" };

describe("cursorEvalRecordSchema (via collection validator)", () => {
  it("accepts representative valid records, sorted by modelId", () => {
    const sorted = validateCursorEvalCollection([validCursorRecord2, validCursorRecord]);
    expect(sorted.map((r) => r.modelId)).toEqual(["composer-2", "gpt-6"]);
  });

  it("preserves the isThirdParty flag for the downstream surcharge", () => {
    const [first, second] = validateCursorEvalCollection([
      validCursorRecord,
      validCursorRecord2,
    ]);
    expect(first?.isThirdParty).toBe(false);
    expect(second?.isThirdParty).toBe(true);
    expect(second?.publishedCostUsd).toBe(1.85);
  });

  it("accepts optional aggregate tokensPerTask/stepsPerTask and preserves them exactly", () => {
    const [second] = validateCursorEvalCollection([validCursorRecord2]);
    expect(second?.tokensPerTask).toBe(115_000);
    expect(second?.stepsPerTask).toBe(46);
    // Records without aggregates (no fields) remain valid.
    expect(() => validateCursorEvalCollection([validCursorRecord])).not.toThrow();
  });

  it("rejects non-numeric aggregate tokensPerTask/stepsPerTask", () => {
    expect(() =>
      validateCursorEvalCollection([{ ...validCursorRecord2, tokensPerTask: "115000" }]),
    ).toThrow();
    expect(() =>
      validateCursorEvalCollection([{ ...validCursorRecord2, stepsPerTask: Number.NaN }]),
    ).toThrow();
  });

  it("rejects scores outside [0, 100]", () => {
    expect(() => validateCursorEvalCollection([invalidCursorScoreOutOfRange])).toThrow(
      /Invalid Cursor eval record at index 0/,
    );
  });

  it("rejects incomplete records (missing provider)", () => {
    expect(() => validateCursorEvalCollection([invalidCursorMissingProvider])).toThrow(
      /Invalid Cursor eval record/,
    );
  });

  it("rejects duplicate model identities", () => {
    const duplicate = { ...validCursorRecord2, modelId: "composer-2" };
    expect(() => validateCursorEvalCollection([validCursorRecord, duplicate])).toThrow(
      /Duplicate Cursor eval identity "composer-2"/,
    );
  });

  it("rejects non-array input", () => {
    expect(() => validateCursorEvalCollection("nope")).toThrow(TypeError);
  });
});

describe("cursorSnapshotPayloadSchema", () => {
  it("accepts a valid payload", () => {
    const parsed = cursorSnapshotPayloadSchema.parse({
      observedAt: VALID_OBSERVED_AT,
      source: SOURCE,
      records: [validCursorRecord, validCursorRecord2],
    });
    expect(parsed.records).toHaveLength(2);
  });

  it("rejects a malformed pageUrl", () => {
    expect(
      cursorSnapshotPayloadSchema.safeParse({
        observedAt: VALID_OBSERVED_AT,
        source: { ...SOURCE, pageUrl: "https://example.com/evals" },
        records: [validCursorRecord],
      }).success,
    ).toBe(false);
  });
});
