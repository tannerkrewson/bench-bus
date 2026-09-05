import { describe, expect, it } from "vitest";
import {
  makeSnapshotEnvelope,
  normalizeSnapshotInput,
  resolveLatestKnownGood,
  resolveManifestEntryAt,
  snapshotEnvelopeSchema,
  snapshotManifestSchema,
} from "./snapshot";
import { SCHEMA_VERSIONS } from "./version";
import { validAaModel, validAaModel2 } from "./fixtures/aa";
import { validateAaModelCollection } from "./aa";

const OBSERVED_AT = "2026-08-21T03:00:00.000Z";

describe("snapshotEnvelopeSchema", () => {
  it("round-trips deterministically through JSON for identical inputs", () => {
    const records = validateAaModelCollection([validAaModel2, validAaModel]);
    const envelope = makeSnapshotEnvelope({ source: "aa", observedAt: OBSERVED_AT, records });
    const first = JSON.stringify(envelope);
    const second = JSON.stringify(
      snapshotEnvelopeSchema.parse(JSON.parse(first)),
    );
    expect(second).toBe(first);
  });

  it("persists AA source metadata needed for generation-aware history", () => {
    const envelope = makeSnapshotEnvelope({
      source: "aa",
      observedAt: OBSERVED_AT,
      records: [validAaModel],
      sourceMetadata: { intelligenceIndexVersion: "4.2" },
    });
    expect(snapshotEnvelopeSchema.parse(envelope).sourceMetadata).toEqual({
      intelligenceIndexVersion: "4.2",
    });
  });

  it("carries the index generation when normalizing an AA collector payload", () => {
    const normalized = snapshotEnvelopeSchema.parse(normalizeSnapshotInput({
      observedAt: OBSERVED_AT,
      source: {
        source: "aa",
        startUrl: "https://artificialanalysis.ai/models/gpt-5-6-luna",
        rscEndpoint: "https://artificialanalysis.ai/models/gpt-5-6-luna",
        intelligenceIndexVersion: "4.2",
      },
      records: [validAaModel],
    }));
    expect(normalized.sourceMetadata).toEqual({
      intelligenceIndexVersion: "4.2",
    });
  });

  it("rejects a recordSchemaVersion that does not match the source", () => {
    expect(
      snapshotEnvelopeSchema.safeParse({
        schemaVersion: SCHEMA_VERSIONS.snapshot,
        source: "aa",
        recordSchemaVersion: SCHEMA_VERSIONS.openrouter + 99,
        observedAt: OBSERVED_AT,
        records: [],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown sources", () => {
    expect(
      snapshotEnvelopeSchema.safeParse({
        schemaVersion: SCHEMA_VERSIONS.snapshot,
        source: "gemini",
        recordSchemaVersion: 1,
        observedAt: OBSERVED_AT,
        records: [],
      }).success,
    ).toBe(false);
  });
});

describe("snapshotManifestSchema", () => {
  const entries = [
    { observedAt: "2026-08-20T03:00:00.000Z", path: "snapshots/aa/2026-08-20T030000Z.json", schemaVersion: SCHEMA_VERSIONS.aa },
    { observedAt: "2026-08-21T03:00:00.000Z", path: "snapshots/aa/2026-08-21T030000Z.json", schemaVersion: SCHEMA_VERSIONS.aa },
  ];

  it("accepts a manifest whose latestKnownGood references an entry", () => {
    const manifest = snapshotManifestSchema.parse({
      schemaVersion: SCHEMA_VERSIONS.manifest,
      source: "aa",
      entries,
      latestKnownGood: entries[1]!.observedAt,
    });
    expect(resolveLatestKnownGood(manifest)?.path).toBe(entries[1]!.path);
  });

  it("rejects a latestKnownGood pointer that references no entry", () => {
    expect(
      snapshotManifestSchema.safeParse({
        schemaVersion: SCHEMA_VERSIONS.manifest,
        source: "aa",
        entries,
        latestKnownGood: "2027-01-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects absolute or non-JSON entry paths", () => {
    expect(
      snapshotManifestSchema.safeParse({
        schemaVersion: SCHEMA_VERSIONS.manifest,
        source: "aa",
        entries: [{ observedAt: entries[0]!.observedAt, path: "/abs/path.json", schemaVersion: 1 }],
        latestKnownGood: entries[0]!.observedAt,
      }).success,
    ).toBe(false);
  });
});

describe("resolveManifestEntryAt", () => {
  const entries = [
    { observedAt: "2026-08-18T03:00:00.000Z", path: "snapshots/aa/a.json", schemaVersion: 1 },
    { observedAt: "2026-08-20T03:00:00.000Z", path: "snapshots/aa/b.json", schemaVersion: 1 },
    { observedAt: "2026-08-21T03:00:00.000Z", path: "snapshots/aa/c.json", schemaVersion: 1 },
  ];

  it("selects the newest entry at or before the requested time", () => {
    expect(resolveManifestEntryAt({ entries }, "2026-08-20T12:00:00.000Z")?.path).toBe(
      "snapshots/aa/b.json",
    );
    expect(resolveManifestEntryAt({ entries }, "2026-08-21T03:00:00.000Z")?.path).toBe(
      "snapshots/aa/c.json",
    );
  });

  it("returns undefined before collected history begins", () => {
    expect(resolveManifestEntryAt({ entries }, "2026-08-01T00:00:00.000Z")).toBeUndefined();
  });

  it("throws on an invalid requested timestamp", () => {
    expect(() => resolveManifestEntryAt({ entries }, "garbage")).toThrow(TypeError);
  });
});
