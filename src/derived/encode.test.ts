import { describe, expect, it } from "vitest";
import { derivedAaChartRecordSchema } from "../schemas";
import { AA_FIXTURE_RECORDS, CURSOR_FIXTURE_RECORDS } from "../charts/fixtures";
import { decodeBundle, encodeAaDataset, encodeCursorDataset, encodeSourceAvailability } from "./encode";

/** Reference fixtures come from the chart system so the codec is proven
 * against exactly the record shapes the frontend consumes. */

const AT = "2026-08-01T00:00:00.000Z";

// The chart fixture set intentionally includes one zero-provider (unplottable)
// record for empty-state testing; it is not a schema-valid derived record, so
// the codec round-trip uses the plottable subset.
const PLOTTABLE_AA_RECORDS = AA_FIXTURE_RECORDS.filter((r) => r.providers.length > 0);

function freshDatasets() {
  return {
    aa: encodeAaDataset({
      freshness: { schemaVersion: 1, asOf: AT, aaObservedAt: AT, openrouterObservedAt: AT, cursorObservedAt: AT },
      records: [...PLOTTABLE_AA_RECORDS],
    }),
    cursor: encodeCursorDataset({
      freshness: { schemaVersion: 1, asOf: AT, aaObservedAt: AT, openrouterObservedAt: AT, cursorObservedAt: AT },
      records: [...CURSOR_FIXTURE_RECORDS],
    }),
  };
}

function bundle(overrides: Partial<Record<string, unknown>> = {}) {
  const { aa, cursor } = freshDatasets();
  return {
    v: 1,
    asOf: AT,
    sources: {
      aa: encodeSourceAvailability({ available: true, observedAt: AT }),
      openrouter: encodeSourceAvailability({ available: true, observedAt: AT }),
      cursor: encodeSourceAvailability({ available: true, observedAt: AT }),
    },
    aa,
    cursor,
    ...overrides,
  };
}

describe("decodeBundle", () => {
  it("round-trips chart fixture records through the compact encoding", () => {
    const decoded = decodeBundle(bundle());
    expect(decoded.asOf).toBe(AT);
    expect(decoded.sources.aa).toEqual({ available: true, observedAt: AT });
    expect(decoded.aa?.records).toHaveLength(PLOTTABLE_AA_RECORDS.length);
    expect(decoded.cursor?.records).toHaveLength(CURSOR_FIXTURE_RECORDS.length);
    // Values round-trip exactly (JSON-safe numbers, strings, flags).
    const first = decoded.aa?.records[0];
    const expected = PLOTTABLE_AA_RECORDS[0];
    expect(first).toEqual(expected);
  });

  it("round-trips explicit provider discount metadata for the AA chart", () => {
    const source = PLOTTABLE_AA_RECORDS[0]!;
    const discounted = {
      ...source,
      providers: [{
        ...source.providers[0]!,
        listedInputPrice: 10,
        listedOutputPrice: 20,
        discountPercentage: 40,
      }],
    };
    const encoded = encodeAaDataset({
      freshness: { schemaVersion: 1, asOf: AT, aaObservedAt: AT, openrouterObservedAt: AT, cursorObservedAt: AT },
      records: [discounted],
    });
    const decoded = decodeBundle(bundle({ aa: encoded }));
    expect(decoded.aa?.records[0]?.providers[0]).toEqual(discounted.providers[0]);
  });

  it("emits schema-valid records for every decoded model", () => {
    const decoded = decodeBundle(bundle());
    for (const record of decoded.aa?.records ?? []) {
      expect(() => derivedAaChartRecordSchema.parse(record)).not.toThrow();
    }
  });

  it("rejects an unsupported bundle version", () => {
    expect(() => decodeBundle(bundle({ v: 99 }))).toThrow(/Unsupported derived bundle version/);
  });

  it("rejects malformed source availability", () => {
    const bad = bundle();
    (bad.sources as Record<string, unknown>).aa = ["yes", AT];
    expect(() => decodeBundle(bad)).toThrow(/Invalid source availability encoding/);
  });

  it("rejects a malformed record tuple", () => {
    const bad = bundle();
    (bad.aa as { m: unknown[] }).m = [["only-one-field"]];
    expect(() => decodeBundle(bad)).toThrow(/Invalid compact AA record/);
  });

  it("rejects a malformed freshness tuple", () => {
    const bad = bundle();
    (bad.cursor as { f: unknown }).f = [AT, AT];
    expect(() => decodeBundle(bad)).toThrow(/Invalid freshness tuple/);
  });

  it("preserves null (unavailable) datasets and optional-field absence", () => {
    const decoded = decodeBundle(bundle({ aa: null }));
    expect(decoded.aa).toBeNull();
    expect(decoded.cursor).not.toBeNull();
    // Cursor fixture rows include records without optional token fields.
    const withoutTokens = decoded.cursor?.records.find((r) => r.inputTokens === undefined);
    expect(withoutTokens).toBeDefined();
  });
});
