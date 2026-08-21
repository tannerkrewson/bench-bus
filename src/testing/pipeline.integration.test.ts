/**
 * Offline end-to-end pipeline integration test (bench-bus-0cd.14).
 *
 * Stitches the full data chain together using only exported pure functions
 * and existing fixtures — no live network:
 *
 *   AA RSC fixture HTML -> collector normalize
 *   -> DataBranchStore snapshot write (all three sources)
 *   -> point-in-time resolve -> derived compile (alias-gated join)
 *   -> compact encode -> browser decode
 *   -> chart adapter point computation (all AA pricing modes + Cursor surcharge)
 *
 * Any break in the shared contracts between collectors, snapshot storage,
 * the derived compiler, the compact codec, and the chart adapters fails here
 * even if every layer's own unit tests pass.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { collectFromHtml } from "../collectors/aa/collector";
import aaPageHtml from "../collectors/aa/fixtures/aa-page.html?raw";
import { buildSnapshotPayload } from "../collectors/cursor/normalize";
import { parseAliasFile, type AliasFile } from "../collectors/openrouter/mapping";
import { selectCheapestProvider as collectorCheapest } from "../collectors/openrouter/cheapest";
import { workloadCost } from "../collectors/openrouter/cheapest";
import { DataBranchStore } from "../snapshots/store";
import { makeSnapshotEnvelope, type ArtificialAnalysisModel } from "../schemas";
import type { OpenRouterModelPricing } from "../schemas";
import { validOpenRouterPricing } from "../schemas/fixtures/openrouter-cursor";
import { compileBundle } from "../derived/compile";
import { decodeBundle } from "../derived/encode";
import { aaAdapter, AA_CONTROL_SPECS } from "../charts/aa/adapter";
import { selectCheapestProvider as chartCheapest } from "../charts/aa/pricing";
import {
  cursorBenchAdapter,
  effectiveCursorCostUsd,
  SURCHARGE_CONTROL_ID,
} from "../charts/cursor/adapter";
import { CURSOR_THIRD_PARTY_SURCHARGE_USD_PER_MILLION_TOKENS } from "../collectors/cursor/surcharge";

// Observation times deliberately staggered so point-in-time semantics are
// exercised: AA first, then Cursor, then OpenRouter.
const AA_OBSERVED_AT = "2026-08-20T00:00:00.000Z";
const CURSOR_OBSERVED_AT = "2026-08-20T06:00:00.000Z";
const OPENROUTER_OBSERVED_AT = "2026-08-20T12:00:00.000Z";
const AA_ONLY_AS_OF = "2026-08-20T03:00:00.000Z";

const AA_START_URL = "https://artificialanalysis.ai/models/claude-opus-5";

/**
 * Alias mapping covering exactly the AA fixture-page models we also have
 * OpenRouter pricing for. The fixture page also contains gpt-5-6-sol-low,
 * which intentionally has NO pricing here (exercises visible unmatched
 * handling end-to-end).
 */
const ALIAS_FILE: AliasFile = parseAliasFile(
  JSON.stringify({
    version: 1,
    description: "pipeline integration test mapping",
    entries: [
      {
        aaModelSlug: "claude-opus-5",
        aaModelId: "b8fc61f7-5e9a-49e6-8547-6ac56db24627",
        openrouterId: "anthropic/claude-opus-5",
        status: "confirmed",
      },
      {
        aaModelSlug: "gpt-5-6-luna-low",
        aaModelId: "050c61cd-cddc-463a-a30a-a82aaa37be59",
        openrouterId: "openai/gpt-5-6-luna-low",
        status: "confirmed",
      },
    ],
  }),
);

/**
 * Second OpenRouter pricing record designed to prove single-provider
 * cheapest-effective selection through the whole chain: providerA is cheapest
 * on input alone, providerB on output alone, but providerB wins the combined
 * workload cost for luna-low's actual canonical token counts.
 */
const LUNA_PRICING: OpenRouterModelPricing = {
  permaslug: "openai/gpt-5-6-luna-low",
  aaModelSlug: "gpt-5-6-luna-low",
  aaModelId: "openai/gpt-5-6-luna-low",
  weightedInputPrice: 1.0,
  weightedOutputPrice: 10.0,
  providerSummaries: [
    {
      providerName: "ProviderA",
      providerSlug: "provider-a",
      effectiveInputPrice: 0.05,
      effectiveOutputPrice: 100,
    },
    {
      providerName: "ProviderB",
      providerSlug: "provider-b",
      effectiveInputPrice: 1,
      effectiveOutputPrice: 10,
    },
  ],
};

const CURSOR_ROWS = [
  {
    rank: 1,
    modelName: "Composer 2",
    scorePercent: 70.8,
    costPerTaskUsd: 2.81,
    tokensPerTask: 41_136,
    stepsPerTask: 46,
    rawCells: ["1", "Composer 2", "70.8%", "$2.81", "41,136", "46"],
  },
  {
    rank: 2,
    modelName: "Opus 5 Max",
    scorePercent: 68.4,
    costPerTaskUsd: 3.4,
    tokensPerTask: 1_500_000,
    stepsPerTask: 52,
    rawCells: ["2", "Opus 5 Max", "68.4%", "$3.40", "1,500,000", "52"],
  },
];

describe("offline end-to-end pipeline: collect -> store -> resolve -> compile -> encode -> decode -> chart", () => {
  const dirPromise = mkdtemp(join(tmpdir(), "bench-bus-pipeline-"));
  let store: DataBranchStore;

  afterAll(async () => {
    await rm(await dirPromise, { recursive: true, force: true });
  });

  it("runs the full chain and produces chart-ready, schema-valid data", async () => {
    // 1. Collect: AA RSC fixture HTML through the real normalize path.
    const aaResult = collectFromHtml(aaPageHtml, AA_START_URL, AA_OBSERVED_AT);
    const aaRecords = aaResult.payload.records as ArtificialAnalysisModel[];
    expect(aaRecords.map((r) => r.slug).sort()).toEqual([
      "claude-opus-5",
      "gpt-5-6-luna-low",
      "gpt-5-6-sol-low",
    ]);

    // 2. Collect: Cursor raw rows through the real normalize path.
    const cursorPayload = buildSnapshotPayload(CURSOR_ROWS, CURSOR_OBSERVED_AT);
    const opus = cursorPayload.records.find((r) => r.modelId === "opus-5-max");
    expect(opus?.isThirdParty).toBe(true);
    expect(opus?.tokensPerTask).toBe(1_500_000);

    // 3. Store all three sources in a real DataBranchStore (full validation).
    // NOTE: collector CLIs emit source payloads; the envelope wrapping shown
    // here (makeSnapshotEnvelope) is exactly the step the production
    // collect-and-store action must perform — see report follow-up F1: the
    // composite action currently pipes collector output into `snapshot write`
    // without this wrapping, which would fail at the store step.
    store = new DataBranchStore(await dirPromise);
    await store.init();
    const storedAa = await store.writeSnapshot(
      makeSnapshotEnvelope({ source: "aa", observedAt: AA_OBSERVED_AT, records: aaRecords }),
    );
    expect(storedAa.path).toContain("snapshots/aa/");
    await store.writeSnapshot(
      makeSnapshotEnvelope({
        source: "openrouter",
        observedAt: OPENROUTER_OBSERVED_AT,
        records: [validOpenRouterPricing, LUNA_PRICING],
      }),
    );
    await store.writeSnapshot(
      makeSnapshotEnvelope({
        source: "cursor",
        observedAt: CURSOR_OBSERVED_AT,
        records: cursorPayload.records,
      }),
    );

    // 4. Point-in-time resolution: latest for every source.
    const resolvedAa = await store.resolveSnapshot("aa", "2030-01-01T00:00:00.000Z");
    expect(resolvedAa?.envelope.observedAt).toBe(AA_OBSERVED_AT);

    // 5. Derived compile: alias-gated join, deterministic bytes.
    const compiled = await compileBundle(store, { aliases: ALIAS_FILE });
    expect(compiled.stats.aaMatched).toBe(2);
    expect(compiled.stats.aaUnmatched).toBe(1); // gpt-5-6-sol-low has no pricing
    expect(compiled.stats.cursorRecords).toBe(2);
    const compiledAgain = await compileBundle(store, { aliases: ALIAS_FILE });
    expect(compiledAgain.json).toBe(compiled.json);

    // 6. Browser decode through the compact codec.
    const decoded = decodeBundle(JSON.parse(compiled.json));
    expect(decoded.aa?.records).toHaveLength(2);
    expect(decoded.cursor?.records).toHaveLength(2);

    // 7. Chart adapters compute sane points from decoded records.
    const claude = decoded.aa?.records.find((r) => r.slug === "claude-opus-5");
    expect(claude).toBeDefined();
    if (!claude) return;

    const controls = Object.fromEntries(
      AA_CONTROL_SPECS.map((spec) => [spec.id, spec.default]),
    );
    const cheapestPoint = aaAdapter.computePoint(claude, {
      ...controls,
      pricingMode: "cheapest",
    });
    expect(cheapestPoint).not.toBeNull();
    expect(cheapestPoint?.y).toBe(claude.intelligenceIndex);
    expect(cheapestPoint?.x).toBeGreaterThan(0);

    // Cheapest mode must equal the collector-side single-provider workload
    // calculation for the same provider — one provider, never mixed.
    const collectorPick = collectorCheapest(validOpenRouterPricing.providerSummaries, {
      inputTokens: claude.canonicalTokens.input,
      outputTokens: claude.canonicalTokens.output,
    });
    const chartPick = chartCheapest(
      claude.providers,
      claude.canonicalTokens.input,
      claude.canonicalTokens.output,
    );
    expect(chartPick?.providerSlug).toBe("chutes"); // not independently cheapest on input
    expect(collectorPick?.provider.providerSlug).toBe("chutes");
    // The collector's workloadCost math and the chart's cheapest selection
    // must agree exactly for the winning provider.
    expect(
      workloadCost(
        { inputTokens: claude.canonicalTokens.input, outputTokens: claude.canonicalTokens.output },
        chartPick!,
      ),
    ).toBeCloseTo(chartPick!.totalCostUsd, 10);
    expect(chartPick?.totalCostUsd).toBeCloseTo(cheapestPoint?.x ?? 0, 10);

    // Weighted mode uses the model-wide weighted prices.
    const weightedPoint = aaAdapter.computePoint(claude, {
      ...controls,
      pricingMode: "weighted",
    });
    const expectedWeighted =
      (claude.canonicalTokens.input / 1e6) * claude.weighted.weightedInputPrice +
      (claude.canonicalTokens.output / 1e6) * claude.weighted.weightedOutputPrice;
    expect(weightedPoint?.x).toBeCloseTo(expectedWeighted, 10);

    // Listed mode responds to the cache-hit slider (90% default).
    const listedDefault = aaAdapter.computePoint(claude, {
      ...controls,
      pricingMode: "listed",
    });
    const listedZero = aaAdapter.computePoint(claude, {
      ...controls,
      pricingMode: "listed",
      cacheHitRate: 0,
    });
    const listedAll = aaAdapter.computePoint(claude, {
      ...controls,
      pricingMode: "listed",
      cacheHitRate: 1,
    });
    expect(listedDefault?.x).toBeGreaterThan(0);
    expect(listedZero!.x!).toBeGreaterThan(listedDefault!.x!); // fewer cache hits = pricier
    expect(listedAll!.x!).toBeLessThan(listedDefault!.x!);

    // Unmatched model (no pricing) is excluded from the compiled dataset and
    // counted, never mispriced; the adapter still refuses to plot a record
    // with no providers (defensive unplottable handling).
    expect(decoded.aa?.records.find((r) => r.slug === "gpt-5-6-sol-low")).toBeUndefined();
    const unplottable = { ...claude, providers: [] };
    expect(aaAdapter.computePoint(unplottable, { ...controls, pricingMode: "cheapest" })).toBeNull();

    // Cursor chart: surcharge toggle moves third-party cost by exactly
    // $0.25/M * tokensPerTask and leaves first-party cost untouched.
    const decodedOpus = decoded.cursor?.records.find((r) => r.modelId === "opus-5-max");
    const decodedComposer = decoded.cursor?.records.find((r) => r.modelId === "composer-2");
    expect(decodedOpus && decodedComposer).toBeTruthy();
    const opusBase = cursorBenchAdapter.computePoint(decodedOpus!, { surcharge: false });
    const opusSurcharged = cursorBenchAdapter.computePoint(decodedOpus!, {
      [SURCHARGE_CONTROL_ID]: true,
    });
    expect(opusBase?.x).toBe(3.4);
    expect(opusSurcharged?.x).toBeCloseTo(
      3.4 + (1_500_000 / 1e6) * CURSOR_THIRD_PARTY_SURCHARGE_USD_PER_MILLION_TOKENS,
      10,
    );
    const composerSurcharged = cursorBenchAdapter.computePoint(decodedComposer!, {
      [SURCHARGE_CONTROL_ID]: true,
    });
    expect(composerSurcharged?.x).toBe(2.81); // first-party: surcharge never applies
    expect(effectiveCursorCostUsd(decodedOpus!, true)).toBeCloseTo(opusSurcharged!.x!, 10);
  });

  it("resolves history: a past view excludes later snapshots instead of failing", async () => {
    // AA-only point in time (before Cursor and OpenRouter snapshots): the AA
    // dataset must be null (no pricing known), not fabricated.
    const past = await compileBundle(store, { asOf: AA_ONLY_AS_OF, aliases: ALIAS_FILE });
    expect(past.sources.aa.available).toBe(true);
    expect(past.sources.openrouter.available).toBe(false);
    expect(past.sources.cursor.available).toBe(false);
    const decodedPast = decodeBundle(JSON.parse(past.json));
    expect(decodedPast.aa).toBeNull();
    expect(decodedPast.cursor).toBeNull();
  });
});
