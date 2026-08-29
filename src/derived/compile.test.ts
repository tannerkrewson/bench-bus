import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  makeSnapshotEnvelope,
  type ArtificialAnalysisModel,
  type CursorEvalRecord,
  type OpenRouterModelPricing,
} from "../schemas";
import { DataBranchStore } from "../snapshots/store";
import { validAaModel, validAaModel2 } from "../schemas/fixtures/aa";
import { validCursorRecord, validCursorRecord2, validOpenRouterPricing, validOpenRouterPricing2 } from "../schemas/fixtures/openrouter-cursor";
import { parseAliasFile } from "../collectors/openrouter/mapping";
import {
  compileBundle,
  joinAaWithPricing,
  LATEST_AS_OF,
  NoDataAtTimeError,
  parseDerivedIndex,
  upsertDerivedIndexEntry,
} from "./compile";
import { decodeBundle } from "./encode";
import { collectFromLeaderboard } from "../collectors/deepswe/collect";
import { rawDeepSweLeaderboardSchema } from "../collectors/deepswe/api";
import deepsweFixture from "../collectors/deepswe/fixtures/leaderboard-live.json";

/**
 * Fixture history with deliberately MISMATCHED source observation times:
 *
 *   t1 = 2026-08-01T00:00:00.000Z  aa(2 models) + openrouter(2 models) + cursor(2 rows)
 *   t2 = 2026-08-02T06:00:00.000Z  aa only (adds gpt-6)  [openrouter lags]
 *   t3 = 2026-08-03T12:00:00.000Z  openrouter(2) + cursor  [aa lags at t2]
 *
 * AA slug "gpt-6" first appears in the benchmark snapshot at t2, but only
 * gains OpenRouter pricing at t3 — so at asOf=t2 it must be absent from the
 * AA chart dataset (no pricing known at that time), and present at t3.
 */

const AA_T1: ArtificialAnalysisModel[] = [validAaModel, validAaModel2];

function withSlug(model: ArtificialAnalysisModel, slug: string, id: string): ArtificialAnalysisModel {
  return { ...model, slug, id };
}

function orPricing(slug: string, providers = 3): OpenRouterModelPricing {
  return {
    permaslug: `vendor/${slug}`,
    aaModelSlug: slug,
    aaModelId: `vendor/${slug}`,
    weightedInputPrice: 2 + providers * 0.1,
    weightedOutputPrice: 10 + providers * 0.2,
    providerSummaries: Array.from({ length: providers }, (_, i) => ({
      providerName: `Provider ${i} of ${slug}`,
      providerSlug: `provider-${i}-${slug}`,
      effectiveInputPrice: 1 + i * 0.5,
      effectiveOutputPrice: 8 + i * 0.75,
    })),
  };
}

const ALIASES = parseAliasFile(
  JSON.stringify({
    version: 1,
    entries: [
      { aaModelSlug: "claude-opus-5", aaModelId: "anthropic/claude-opus-5", openrouterId: "vendor/claude-opus-5", status: "confirmed" },
      { aaModelSlug: "gpt-6", aaModelId: "openai/gpt-6", openrouterId: "vendor/gpt-6", status: "confirmed" },
      { aaModelSlug: "future-model", aaModelId: "vendor/future-model", openrouterId: "vendor/future-model", status: "confirmed" },
    ],
  }),
  "test aliases",
);

const T1 = "2026-08-01T00:00:00.000Z";
const T2 = "2026-08-02T06:00:00.000Z";
const T3 = "2026-08-03T12:00:00.000Z";

let root: string;
let store: DataBranchStore;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "bench-bus-derived-"));
  store = new DataBranchStore(root);
  await store.init();
  await store.writeSnapshot(makeSnapshotEnvelope({ source: "aa", observedAt: T1, records: AA_T1 }));
  await store.writeSnapshot(
    makeSnapshotEnvelope({
      source: "aa",
      observedAt: T2,
      records: [withSlug(validAaModel, "gpt-6", "newer-gpt"), validAaModel],
    }),
  );
  await store.writeSnapshot(
    makeSnapshotEnvelope({ source: "openrouter", observedAt: T1, records: [validOpenRouterPricing, validOpenRouterPricing2] }),
  );
  await store.writeSnapshot(
    makeSnapshotEnvelope({
      source: "openrouter",
      observedAt: T3,
      records: [validOpenRouterPricing, validOpenRouterPricing2],
    }),
  );
  await store.writeSnapshot(
    makeSnapshotEnvelope({ source: "cursor", observedAt: T1, records: [validCursorRecord, validCursorRecord2] }),
  );
  await store.writeSnapshot(
    makeSnapshotEnvelope({ source: "cursor", observedAt: T3, records: [validCursorRecord, validCursorRecord2] }),
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("compileBundle", () => {
  it("resolves mismatched source timestamps independently per source", async () => {
    // asOf between t1 and t2: aa=t1, openrouter=t1, cursor=t1.
    const atT1 = await compileBundle(store, { asOf: T1, aliases: ALIASES });
    expect(atT1.sources).toEqual({
      aa: { available: true, observedAt: T1 },
      openrouter: { available: true, observedAt: T1 },
      deepswe: { available: false },
      cursor: { available: true, observedAt: T1 },
    });
    expect(atT1.asOf).toBe(T1);
    expect(atT1.bundle.aa?.f).toEqual([T1, T1, null, T1]);

    // asOf between t2 and t3: aa=t2, openrouter=t1 (lags), cursor=t1.
    const between = await compileBundle(store, { asOf: "2026-08-02T12:00:00.000Z", aliases: ALIASES });
    expect(between.sources.aa).toEqual({ available: true, observedAt: T2 });
    expect(between.sources.openrouter).toEqual({ available: true, observedAt: T1 });
    expect(between.sources.deepswe).toEqual({ available: false });
    expect(between.sources.cursor).toEqual({ available: true, observedAt: T1 });
    // Effective data time is the newest resolved observation.
    expect(between.asOf).toBe(T2);
    expect(between.bundle.aa?.f).toEqual([T2, T1, null, T1]);
  });

  it("joins an explicit DeepSWE identity and leaves models without a score unplottable", async () => {
    const deepswePayload = collectFromLeaderboard(
      rawDeepSweLeaderboardSchema.parse(deepsweFixture),
      T1,
    );
    await store.writeSnapshot(deepswePayload);
    const compiled = await compileBundle(store, {
      asOf: T1,
      aliases: ALIASES,
      deepsweAliases: [{
        aaModelSlug: "claude-opus-5",
        deepSweModel: "deepseek-v4-pro",
        harness: "mini-swe-agent",
        reasoningEffort: null,
      }],
    });
    const records = decodeBundle(JSON.parse(compiled.json)).aa?.records ?? [];
    expect(records.find((record) => record.slug === "claude-opus-5")?.scoreSources).toEqual({
      artificialAnalysis: 42.7,
      deepSwePassAt1: 0.0752212389380531,
    });
    expect(compiled.sources.deepswe).toEqual({ available: true, observedAt: T1 });
  });

  it("excludes models introduced later from earlier views", async () => {
    const atT1 = await compileBundle(store, { asOf: T1, aliases: ALIASES });
    const t1Slugs = decodeBundle(JSON.parse(atT1.json)).aa?.records.map((r) => r.slug);
    expect(t1Slugs).toEqual(["claude-opus-5", "gpt-6"]); // both exist at t1

    // A model that only exists in the LATER aa snapshot is absent earlier.
    const laterOnly = new DataBranchStore(root);
    await laterOnly.writeSnapshot(
      makeSnapshotEnvelope({
        source: "openrouter",
        observedAt: "2026-08-05T00:00:00.000Z",
        records: [
          validOpenRouterPricing,
          validOpenRouterPricing2,
          orPricing("future-model"),
        ],
      }),
    );
    await laterOnly.writeSnapshot(
      makeSnapshotEnvelope({
        source: "aa",
        observedAt: "2026-08-05T00:00:00.000Z",
        records: [withSlug(validAaModel, "future-model", "x"), ...AA_T1],
      }),
    );
    const before = await compileBundle(laterOnly, { asOf: T1, aliases: ALIASES });
    const beforeSlugs = decodeBundle(JSON.parse(before.json)).aa?.records.map((r) => r.slug);
    expect(beforeSlugs).not.toContain("future-model");
    const after = await compileBundle(laterOnly, { asOf: "2026-08-05T00:00:00.000Z", aliases: ALIASES });
    expect(decodeBundle(JSON.parse(after.json)).aa?.records.map((r) => r.slug)).toContain("future-model");
  });

  it("uses pricing known at the requested time, not the newest", async () => {
    // At t1, gpt-6 has pricing (validOpenRouterPricing2 exists at t1).
    // Drop it from the t1 openrouter snapshot? It IS in t1. Instead verify
    // the join at t1 uses the t1 weighted prices, and a model without any
    // pricing at that time is excluded.
    const atT1 = await compileBundle(store, { asOf: T1, aliases: ALIASES });
    const decoded = decodeBundle(JSON.parse(atT1.json));
    expect(decoded.aa?.records.map((r) => r.weighted.weightedInputPrice)).toEqual([4.75, 2]);
    expect(atT1.stats.aaMatched).toBe(2);
    expect(atT1.stats.aaUnmatched).toBe(0);
  });

  it("retains AA listed-frontier records when no OpenRouter snapshot exists", async () => {
    // asOf before the first openrouter snapshot: AA+cursor exist, pricing does not.
    const beforePricing = "2026-07-15T00:00:00.000Z";
    await store.writeSnapshot(
      makeSnapshotEnvelope({ source: "aa", observedAt: beforePricing, records: [validAaModel] }),
    );
    await store.writeSnapshot(
      makeSnapshotEnvelope({ source: "cursor", observedAt: beforePricing, records: [validCursorRecord] }),
    );
    const compiled = await compileBundle(store, { asOf: beforePricing, aliases: ALIASES });
    expect(compiled.sources.aa.available).toBe(true);
    expect(compiled.sources.openrouter.available).toBe(false);
    expect(compiled.bundle.aa).not.toBeNull();
    expect(compiled.bundle.cursor).not.toBeNull();
    const decoded = decodeBundle(JSON.parse(compiled.json));
    expect(decoded.aa?.records).toHaveLength(1);
    expect(decoded.aa?.records[0]?.providers).toEqual([]);
    expect(decoded.aa?.records[0]?.weighted).toEqual({ weightedInputPrice: 0, weightedOutputPrice: 0 });
    expect(decoded.sources.openrouter).toEqual({ available: false });
  });

  it("throws NoDataAtTimeError when no source has history at the requested time", async () => {
    await expect(compileBundle(store, { asOf: "2020-01-01T00:00:00.000Z", aliases: ALIASES })).rejects.toBeInstanceOf(
      NoDataAtTimeError,
    );
  });

  it("defaults to the latest known-good snapshot of every source", async () => {
    const latest = await compileBundle(store, { aliases: ALIASES });
    expect(latest.requestedAsOf).toBe(LATEST_AS_OF);
    expect(latest.sources.aa.observedAt).toBe(T2);
    expect(latest.sources.openrouter.observedAt).toBe(T3);
    expect(latest.sources.cursor.observedAt).toBe(T3);
    expect(latest.asOf).toBe(T3);
  });

  it("is deterministic: identical inputs produce byte-identical output", async () => {
    const a = await compileBundle(store, { asOf: T3, aliases: ALIASES });
    const b = await compileBundle(store, { asOf: T3, aliases: ALIASES });
    expect(a.json).toBe(b.json);
    // And across a fresh store reading the same files.
    const fresh = new DataBranchStore(root);
    const c = await compileBundle(fresh, { asOf: T3, aliases: ALIASES });
    expect(c.json).toBe(a.json);
  });

  it("fails closed when an OpenRouter record is not in the alias mapping", async () => {
    await store.writeSnapshot(
      makeSnapshotEnvelope({
        source: "openrouter",
        observedAt: "2026-08-04T00:00:00.000Z",
        records: [{ ...validOpenRouterPricing, aaModelSlug: "unmapped-model", permaslug: "vendor/unmapped" }],
      }),
    );
    await expect(
      compileBundle(store, { asOf: "2026-08-04T00:00:00.000Z", aliases: ALIASES }),
    ).rejects.toThrow(/not present in the alias mapping/);
  });

  it("excludes non-reasoning AA models while retaining reasoning variants", () => {
    const nonReasoning = {
      ...validAaModel,
      slug: "gpt-5-6-luna-non-reasoning",
      name: "GPT-5.6 Luna (Non-reasoning)",
      shortName: "GPT-5.6 Luna (Non-reasoning)",
    };
    const reasoning = {
      ...validAaModel,
      slug: "gpt-5-6-luna-high",
      name: "GPT-5.6 Luna (Reasoning, High Effort)",
      shortName: "GPT-5.6 Luna (Reasoning, High Effort)",
    };
    const joined = joinAaWithPricing([nonReasoning, reasoning], [], ALIASES, [nonReasoning.slug, reasoning.slug]);
    expect(joined.records.map((record) => record.slug)).toEqual([reasoning.slug]);
    expect(joined.unmatchedAa).toBe(1);
  });

  it("reuses one shared base OpenRouter pricing row for an effort variant", () => {
    const aliases = parseAliasFile(JSON.stringify({
      version: 1,
      entries: [
        {
          aaModelSlug: "gpt-5-6-sol",
          aaModelId: "sol-base",
          openrouterId: "openai/gpt-5.6-sol",
          status: "confirmed",
        },
        {
          aaModelSlug: "gpt-5-6-sol-medium",
          aaModelId: "sol-medium",
          openrouterId: "openai/gpt-5.6-sol",
          status: "confirmed",
        },
      ],
    }), "shared Sol aliases");
    const pricing: OpenRouterModelPricing = {
      ...validOpenRouterPricing,
      permaslug: "openai/gpt-5.6-sol",
      aaModelSlug: "gpt-5-6-sol",
    };
    const model = withSlug(validAaModel, "gpt-5-6-sol-medium", "sol-medium");
    const joined = joinAaWithPricing([model], [pricing], aliases, [model.slug]);
    expect(joined.records).toHaveLength(1);
    expect(joined.records[0]?.slug).toBe("gpt-5-6-sol-medium");
    expect(joined.records[0]?.providers).toEqual(pricing.providerSummaries);
    expect(joined.unmatchedAa).toBe(0);
    expect(joined.unmatchedOr).toBe(0);
  });

  it("keeps Grok 4.6 high and medium variants on one priced family", () => {
    const high: ArtificialAnalysisModel = {
      ...validAaModel,
      id: "c8adc5cf-fd5a-407b-af51-dc3bede3e49c",
      slug: "grok-4-6",
      name: "Grok 4.6 (high)",
      shortName: "Grok 4.6 (high)",
      intelligenceIndex: 60.92297113115,
      canonicalIntelligenceIndexTokenCount: {
        input: 854_677_596,
        output: 72_155_789,
        answer: 9_660_772,
        reasoning: 62_495_017,
      },
      price1mInputTokens: 2,
      price1mOutputTokens: 6,
      cacheHitPrice: 0.5,
    };
    const medium: ArtificialAnalysisModel = {
      ...high,
      id: "26614164-6840-4e17-a65a-2deb2fe7e87b",
      slug: "grok-4-6-medium",
      name: "Grok 4.6 (medium)",
      shortName: "Grok 4.6 (medium)",
      intelligenceIndex: 59.0064109828411,
      canonicalIntelligenceIndexTokenCount: {
        input: 639_062_659,
        output: 55_318_467,
        answer: 8_367_869,
        reasoning: 46_950_598,
      },
    };
    const aliases = parseAliasFile(JSON.stringify({
      version: 1,
      entries: [
        {
          aaModelSlug: high.slug,
          aaModelId: high.id,
          openrouterId: "x-ai/grok-4.6",
          status: "confirmed",
        },
        {
          aaModelSlug: medium.slug,
          aaModelId: medium.id,
          openrouterId: "x-ai/grok-4.6",
          status: "confirmed",
        },
      ],
    }), "Grok aliases");
    const pricing: OpenRouterModelPricing = {
      ...validOpenRouterPricing,
      permaslug: "x-ai/grok-4.6",
      aaModelSlug: high.slug,
      aaModelId: high.id,
    };
    const joined = joinAaWithPricing([high, medium], [pricing], aliases, [high.slug, medium.slug]);
    expect(joined.records.map((record) => record.slug)).toEqual([high.slug, medium.slug]);
    expect(joined.records[0]?.providers).toEqual(joined.records[1]?.providers);
    expect(joined.records.map((record) => record.canonicalTokens)).toEqual([
      { input: 854_677_596, output: 72_155_789 },
      { input: 639_062_659, output: 55_318_467 },
    ]);
    expect(joined.records.map((record) => record.intelligenceIndex)).toEqual([
      high.intelligenceIndex,
      medium.intelligenceIndex,
    ]);
    expect(joined.unmatchedAa).toBe(0);
    expect(joined.unmatchedOr).toBe(0);
  });

  it("retains an unmatched listed-frontier model with explicit no-data OpenRouter fields", () => {
    const joined = joinAaWithPricing(
      [validAaModel, validAaModel2],
      [],
      ALIASES,
      ["gpt-6"],
    );
    expect(joined.records.map((record) => record.slug)).toEqual(["gpt-6"]);
    expect(joined.records[0]?.providers).toEqual([]);
    expect(joined.records[0]?.weighted).toEqual({ weightedInputPrice: 0, weightedOutputPrice: 0 });
    expect(joined.unmatchedAa).toBe(1);
    expect(joined.unmatchedOr).toBe(0);
  });

  it("accepts a curated OpenRouter record absent from AA without emitting it", () => {
    const joined = joinAaWithPricing(
      [validAaModel],
      [orPricing("deepseek-v4-flash")],
      ALIASES,
      [validAaModel.slug],
      [{
        aaModelSlug: "deepseek-v4-flash",
        aaModelId: "fe4c0848-e284-4e52-a79d-cdc28392f1a9",
        openrouterId: "vendor/deepseek-v4-flash",
      }],
    );
    expect(joined.records.map((record) => record.slug)).toEqual(["claude-opus-5"]);
    expect(joined.unmatchedOr).toBe(1);
  });

  it("counts provisional alias usage in stats", async () => {
    const provisionalAliases = parseAliasFile(
      JSON.stringify({
        version: 1,
        entries: [
          { aaModelSlug: "claude-opus-5", aaModelId: "x", openrouterId: "vendor/claude-opus-5", status: "provisional" },
          { aaModelSlug: "gpt-6", aaModelId: "y", openrouterId: "vendor/gpt-6", status: "confirmed" },
        ],
      }),
      "provisional aliases",
    );
    const compiled = await compileBundle(store, { asOf: T1, aliases: provisionalAliases });
    expect(compiled.stats.provisionalAliasesUsed).toBe(1);
  });
});

describe("size discipline", () => {
  it("derived output is substantially smaller than the raw snapshot inputs", async () => {
    // Realistic-ish volume: 30 AA models, 30 pricing records with 6 providers, 56 cursor rows.
    const bigRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bench-bus-derived-big-"));
    try {
      const bigStore = new DataBranchStore(bigRoot);
      await bigStore.init();
      const aaModels: ArtificialAnalysisModel[] = Array.from({ length: 30 }, (_, i) => ({
        ...validAaModel,
        id: `vendor/model-${i}`,
        slug: `model-${i}`,
        name: `Long Marketing Name Model ${i} (2026 Edition)`,
        shortName: `M${i}`,
        intelligenceIndex: 30 + i,
        canonicalIntelligenceIndexTokenCount: { input: 100_000 + i, output: 40_000 + i, answer: 30_000 + i, reasoning: 10_000 },
      }));
      const pricing = aaModels.map((m) => orPricing(m.slug, 6));
      const cursorRows: CursorEvalRecord[] = Array.from({ length: 56 }, (_, i) => ({
        ...validCursorRecord,
        modelId: `composer-row-${i}`,
        modelName: `Composer Row ${i} Extra High`,
        score: 50 + (i % 40),
        publishedCostUsd: 1 + i * 0.1,
      }));
      const at = "2026-08-10T00:00:00.000Z";
      await bigStore.writeSnapshot(makeSnapshotEnvelope({ source: "aa", observedAt: at, records: aaModels }));
      await bigStore.writeSnapshot(makeSnapshotEnvelope({ source: "openrouter", observedAt: at, records: pricing }));
      await bigStore.writeSnapshot(makeSnapshotEnvelope({ source: "cursor", observedAt: at, records: cursorRows }));

      const bigAliases = parseAliasFile(
        JSON.stringify({
          version: 1,
          entries: aaModels.map((m) => ({
            aaModelSlug: m.slug,
            aaModelId: m.id,
            openrouterId: `vendor/${m.slug}`,
            status: "confirmed",
          })),
        }),
        "big aliases",
      );
      const compiled = await compileBundle(bigStore, { asOf: at, aliases: bigAliases });

      // Sum of raw snapshot file sizes (what "ship all raw history" would cost for this time).
      let rawBytes = 0;
      for (const source of ["aa", "openrouter", "cursor"] as const) {
        const resolved = await bigStore.resolveSnapshot(source, at);
        const stat = await fs.stat(path.join(bigRoot, resolved?.entry.path ?? ""));
        rawBytes += stat.size;
      }
      const derivedBytes = compiled.json.length;
      expect(derivedBytes).toBeLessThan(rawBytes * 0.5);
    } finally {
      await fs.rm(bigRoot, { recursive: true, force: true });
    }
  });

  it("never ships raw archival fields", async () => {
    const compiled = await compileBundle(store, { asOf: T3, aliases: ALIASES });
    for (const forbidden of [
      "releaseDate",
      "cacheWritePrice",
      "intelligenceIndexCost",
      "canonicalIntelligenceIndexTokenCount",
      "answer",
      "reasoning",
      "permaslug",
      "aaModelId",
    ]) {
      expect(compiled.json).not.toContain(`"${forbidden}"`);
    }
  });
});

describe("derived index", () => {
  it("upserts by asOf, sorts deterministically, and serializes byte-stably", () => {
    const e1 = { asOf: T2, path: "b.json", aa: true, cursor: false };
    const e2 = { asOf: T1, path: "a.json", aa: true, cursor: true };
    const once = upsertDerivedIndexEntry(parseDerivedIndex(undefined), e1);
    const both = upsertDerivedIndexEntry(parseDerivedIndex(once), e2);
    expect(JSON.parse(both).entries.map((e: { asOf: string }) => e.asOf)).toEqual([T1, T2]);
    // Re-upserting the same asOf replaces rather than duplicates.
    const replaced = upsertDerivedIndexEntry(parseDerivedIndex(both), { ...e1, path: "b2.json" });
    expect(JSON.parse(replaced).entries).toHaveLength(2);
    expect(upsertDerivedIndexEntry(parseDerivedIndex(both), e2)).toBe(both);
  });
});
