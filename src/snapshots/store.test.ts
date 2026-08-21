import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  makeSnapshotEnvelope,
  type ArtificialAnalysisModel,
  type CursorEvalRecord,
  type OpenRouterModelPricing,
} from "../schemas";
import {
  validAaModel,
  validAaModel2,
} from "../schemas/fixtures/aa";
import {
  validCursorRecord,
  validCursorRecord2,
  validOpenRouterPricing,
  validOpenRouterPricing2,
} from "../schemas/fixtures/openrouter-cursor";
import { snapshotPath } from "./paths";
import { DataBranchStore, validateRecords } from "./store";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "bench-bus-data-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const T1 = "2026-08-20T03:00:00.000Z";
const T2 = "2026-08-21T03:00:00.000Z";
const T3 = "2026-08-22T03:00:00.000Z";

function aaEnvelope(observedAt: string, records: ArtificialAnalysisModel[] = [validAaModel, validAaModel2]) {
  return makeSnapshotEnvelope({ source: "aa", observedAt, records });
}

function openRouterEnvelope(observedAt: string, records: OpenRouterModelPricing[] = [validOpenRouterPricing, validOpenRouterPricing2]) {
  return makeSnapshotEnvelope({ source: "openrouter", observedAt, records });
}

function cursorEnvelope(observedAt: string, records: CursorEvalRecord[] = [validCursorRecord, validCursorRecord2]) {
  return makeSnapshotEnvelope({ source: "cursor", observedAt, records });
}

describe("DataBranchStore.init", () => {
  it("creates the skeleton on a first run and is idempotent", async () => {
    const store = new DataBranchStore(root);
    await store.init();
    await store.init();
    await expect(store.readManifest("aa")).resolves.toBeUndefined();
  });
});

describe("DataBranchStore.writeSnapshot", () => {
  it("accepts raw collector source payloads and normalizes them to envelopes", async () => {
    // Regression: the Actions composite action pipes collector CLI output
    // (source payload shape) directly into snapshot write. The store must
    // normalize it instead of failing strict envelope validation.
    const store = new DataBranchStore(root);
    await store.init();
    const collectorPayload = {
      observedAt: T1,
      source: { source: "aa" as const, modelPageUrl: "https://artificialanalysis.ai/models/x" },
      records: [validAaModel, validAaModel2],
    };
    const stored = await store.writeSnapshot(collectorPayload);
    expect(stored.path).toBe(snapshotPath("aa", 1, T1));
    expect(stored.manifest.latestKnownGood).toBe(T1);
    const resolved = await store.resolveSnapshot("aa", T2);
    expect(resolved?.envelope.observedAt).toBe(T1);
    expect(resolved?.envelope.records).toHaveLength(2);
  });

  it("still rejects payloads with an unknown nested source", async () => {
    const store = new DataBranchStore(root);
    await store.init();
    await expect(
      store.writeSnapshot({
        observedAt: T1,
        source: { source: "unknown-source" },
        records: [validAaModel],
      }),
    ).rejects.toThrow();
  });

  it("persists the first snapshot at a deterministic path with a correct manifest", async () => {
    const store = new DataBranchStore(root);
    await store.init();
    const stored = await store.writeSnapshot(aaEnvelope(T2));
    expect(stored.path).toBe(snapshotPath("aa", 1, T2));
    expect(stored.manifest.latestKnownGood).toBe(T2);
    expect(stored.manifest.entries).toEqual([
      { observedAt: T2, path: stored.path, schemaVersion: 1 },
    ]);
    await expect(store.latestKnownGood("aa")).resolves.toEqual(stored.entry);
  });

  it("appends later snapshots without rewriting earlier entries", async () => {
    const store = new DataBranchStore(root);
    await store.init();
    const first = await store.writeSnapshot(aaEnvelope(T1));
    const second = await store.writeSnapshot(aaEnvelope(T2));
    expect(second.manifest.entries).toEqual([first.entry, second.entry]);
    expect(second.manifest.latestKnownGood).toBe(T2);
    // First file untouched and byte-identical history preserved.
    await expect(store.resolveSnapshot("aa", T1)).resolves.toBeDefined();
  });

  it("refuses to overwrite an existing snapshot path and leaves state untouched", async () => {
    const store = new DataBranchStore(root);
    await store.init();
    await store.writeSnapshot(aaEnvelope(T1));
    const manifestBefore = await store.readManifest("aa");
    await expect(store.writeSnapshot(aaEnvelope(T1))).rejects.toThrow(
      /Refusing to overwrite/,
    );
    await expect(store.readManifest("aa")).resolves.toEqual(manifestBefore);
  });

  it("rejects a duplicate manifest observedAt even if the file is missing", async () => {
    const store = new DataBranchStore(root);
    await store.init();
    await store.writeSnapshot(aaEnvelope(T1));
    await rm(path.join(root, snapshotPath("aa", 1, T1)));
    await expect(store.writeSnapshot(aaEnvelope(T1))).rejects.toThrow(
      /Manifest already contains/,
    );
  });

  it("rejects invalid records before writing anything", async () => {
    const store = new DataBranchStore(root);
    await store.init();
    await store.writeSnapshot(aaEnvelope(T1));
    const manifestBefore = await store.readManifest("aa");
    const bad = aaEnvelope(T2, [
      { ...validAaModel, canonicalIntelligenceIndexTokenCount: { input: 1, output: 2, answer: 1, reasoning: 0 } },
    ] as unknown as ArtificialAnalysisModel[]);
    await expect(store.writeSnapshot(bad)).rejects.toThrow(/output must equal answer \+ reasoning/);
    await expect(store.readManifest("aa")).resolves.toEqual(manifestBefore);
    // The newest resolvable snapshot is still the previous valid one.
    await expect(store.resolveSnapshot("aa", T2)).resolves.toMatchObject({
      entry: { observedAt: T1 },
    });
  });

  it("rejects empty collections by default but allows with allowEmpty", async () => {
    const store = new DataBranchStore(root);
    await store.init();
    await expect(store.writeSnapshot(aaEnvelope(T1, []))).rejects.toThrow(/empty aa snapshot/);
    await expect(store.writeSnapshot(aaEnvelope(T1, []), { allowEmpty: true })).resolves.toBeDefined();
  });

  it("serializes deterministically for identical inputs", async () => {
    const storeA = new DataBranchStore(root);
    await storeA.init();
    await storeA.writeSnapshot(aaEnvelope(T1));
    const bytesA = await readFile(path.join(root, snapshotPath("aa", 1, T1)), "utf8");

    const otherRoot = await mkdtemp(path.join(tmpdir(), "bench-bus-data-"));
    try {
      const storeB = new DataBranchStore(otherRoot);
      await storeB.init();
      // Same records, deliberately unsorted input order.
      await storeB.writeSnapshot(aaEnvelope(T1, [validAaModel2, validAaModel]));
      const bytesB = await readFile(path.join(otherRoot, snapshotPath("aa", 1, T1)), "utf8");
      expect(bytesB).toBe(bytesA);
    } finally {
      await rm(otherRoot, { recursive: true, force: true });
    }
  });
});

describe("point-in-time resolution", () => {
  it("resolves each source independently across mismatched timestamps", async () => {
    const store = new DataBranchStore(root);
    await store.init();
    await store.writeSnapshot(aaEnvelope(T3));
    await store.writeSnapshot(openRouterEnvelope(T1));
    await store.writeSnapshot(cursorEnvelope(T2));

    // A historical view between the three observation times picks each
    // source's own newest snapshot at or before the requested time.
    const mid = "2026-08-21T12:00:00.000Z";
    await expect(store.resolveSnapshot("aa", mid)).resolves.toBeUndefined(); // AA history starts at T3
    await expect(store.resolveSnapshot("openrouter", mid)).resolves.toMatchObject({
      entry: { observedAt: T1 },
    });
    await expect(store.resolveSnapshot("cursor", mid)).resolves.toMatchObject({
      entry: { observedAt: T2 },
    });

    const now = "2026-09-01T00:00:00.000Z";
    await expect(store.resolveSnapshot("aa", now)).resolves.toMatchObject({ entry: { observedAt: T3 } });
    await expect(store.resolveSnapshot("openrouter", now)).resolves.toMatchObject({ entry: { observedAt: T1 } });
    await expect(store.resolveSnapshot("cursor", now)).resolves.toMatchObject({ entry: { observedAt: T2 } });
  });

  it("returns undefined before any history and at exactly the first snapshot boundary", async () => {
    const store = new DataBranchStore(root);
    await store.init();
    await store.writeSnapshot(aaEnvelope(T2));
    await expect(store.resolveSnapshot("aa", T1)).resolves.toBeUndefined();
    // At-or-before is inclusive of the snapshot's own observation time.
    await expect(store.resolveSnapshot("aa", T2)).resolves.toMatchObject({ entry: { observedAt: T2 } });
  });

  it("fails closed on a corrupted snapshot file instead of returning bad data", async () => {
    const store = new DataBranchStore(root);
    await store.init();
    await store.writeSnapshot(aaEnvelope(T1));
    const file = path.join(root, snapshotPath("aa", 1, T1));
    await writeFile(file, '{"schemaVersion":1,"source":"aa","records":"corrupted"}', "utf8");
    await expect(store.resolveSnapshot("aa", T2)).rejects.toThrow();
    // And the manifest still points at the entry, so the failure is visible
    // rather than silently skipping history.
    await expect(store.latestKnownGood("aa")).resolves.toMatchObject({ observedAt: T1 });
  });

  it("ignores orphan files not referenced by the manifest", async () => {
    const store = new DataBranchStore(root);
    await store.init();
    await store.writeSnapshot(aaEnvelope(T1));
    const orphanDir = path.join(root, "snapshots/aa/v1");
    await mkdir(orphanDir, { recursive: true });
    const orphanEnvelope = aaEnvelope(T3);
    await writeFile(
      path.join(orphanDir, "20260822T030000Z.json"),
      JSON.stringify(orphanEnvelope),
      "utf8",
    );
    // Resolution only trusts the manifest: the orphan (newer!) is not served.
    await expect(store.resolveSnapshot("aa", "2026-09-01T00:00:00.000Z")).resolves.toMatchObject({
      entry: { observedAt: T1 },
    });
    await expect(store.listOrphans("aa")).resolves.toEqual(["snapshots/aa/v1/20260822T030000Z.json"]);
  });
});

describe("DataBranchStore.compactManifest", () => {
  it("normalizes entry order without deleting any snapshot file", async () => {
    const store = new DataBranchStore(root);
    await store.init();
    await store.writeSnapshot(aaEnvelope(T2));
    await store.writeSnapshot(aaEnvelope(T1));
    const compacted = await store.compactManifest("aa");
    expect(compacted.entries.map((e) => e.observedAt)).toEqual([T1, T2]);
    expect(compacted.latestKnownGood).toBe(T1); // preserved, still an entry
    // Both snapshot files still exist on disk.
    await expect(store.resolveSnapshot("aa", T1)).resolves.toBeDefined();
    await expect(store.resolveSnapshot("aa", T2)).resolves.toBeDefined();
  });

  it("throws when there is no manifest yet", async () => {
    const store = new DataBranchStore(root);
    await store.init();
    await expect(store.compactManifest("aa")).rejects.toThrow(/No manifest/);
  });
});

describe("validateRecords", () => {
  it("sorts AA records by slug and rejects duplicates", () => {
    const sorted = validateRecords("aa", [validAaModel2, validAaModel]);
    expect(sorted).toHaveLength(2);
    expect(() => validateRecords("aa", [validAaModel, validAaModel])).toThrow(/Duplicate/);
  });

  it("validates OpenRouter records and rejects duplicate aaModelSlug", () => {
    expect(validateRecords("openrouter", [validOpenRouterPricing2, validOpenRouterPricing])).toHaveLength(2);
    expect(() => validateRecords("openrouter", [validOpenRouterPricing, validOpenRouterPricing])).toThrow(
      /Duplicate/,
    );
  });

  it("validates Cursor records via the shared collection validator", () => {
    expect(validateRecords("cursor", [validCursorRecord2, validCursorRecord])).toHaveLength(2);
  });
});
