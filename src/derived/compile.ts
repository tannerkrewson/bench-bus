import {
  SCHEMA_VERSIONS,
  type ArtificialAnalysisModel,
  type CursorEvalRecord,
  type DerivedAaChartRecord,
  type DerivedCursorChartRecord,
  type DeepSweScoreRecord,
  type OpenRouterModelPricing,
} from "../schemas";
import type { DataBranchStore, ResolvedSnapshot } from "../snapshots/store";
import type { AliasFile } from "../collectors/openrouter/mapping";
import { DEFAULT_CURATED_MODELS, type CuratedModel } from "../collectors/openrouter/curated";
import {
  DEFAULT_DEEPSWE_ALIASES,
  deepSweScoreIdentity,
  type DeepSweAliasEntry,
} from "../collectors/deepswe/mapping";
import { isNonReasoningModel } from "../charts/modelMetadata";
import { computeAaListedParetoFrontier, aaListedWorkloadCost } from "../collectors/aa/frontier";
import {
  encodeAaDataset,
  encodeCursorDataset,
  encodeSourceAvailability,
  type CompactBundle,
} from "./encode";

/**
 * Build-time compiler: reads validated per-source snapshots out of a
 * bench-bus-data checkout (via {@link DataBranchStore}) and emits the compact
 * static JSON bundle the browser ships, plus an index of compiled views.
 *
 * Semantics:
 * - Each source resolves INDEPENDENTLY to its newest valid snapshot at or
 *   before the requested time (mismatched source observation times are
 *   expected and preserved as freshness metadata).
 * - A past view naturally excludes models that the historical benchmark
 *   snapshot does not contain, and uses pricing as known at that time.
 * - Nothing is ever fabricated: a source with no snapshot at or before the
 *   requested time is reported unavailable. Source-backed AA frontier models
 *   with valid AA listed prices remain in the AA dataset when OpenRouter
 *   pricing is unavailable; their provider and weighted fields are explicit
 *   no-data values and chart modes that need OpenRouter pricing stay null.
 */

/**
 * "Latest" sentinel: resolves every source's newest known-good snapshot.
 * Far-future so `resolveSnapshot(at)` selects the newest entry.
 */
export const LATEST_AS_OF = "9999-12-31T23:59:59.999Z";

/** Thrown when no source has any snapshot at or before the requested time. */
export class NoDataAtTimeError extends Error {}

export interface CompileOptions {
  /**
   * Requested point in time (ISO UTC). Defaults to {@link LATEST_AS_OF}
   * (the newest known-good snapshot of every source).
   */
  asOf?: string;
  /**
   * Explicit AA -> OpenRouter mapping. The join is validated against it:
   * an OpenRouter pricing record whose aaModelSlug is not in the mapping or
   * explicit curated identities fails the build (mapping integrity), rather
   * than silently pricing a model through an unsanctioned link.
   */
  aliases: AliasFile;
  /** Optional precomputed frontier identities; defaults to the AA snapshot. */
  frontierSlugs?: readonly string[];
  /** Explicit operator-approved OpenRouter identities, including models absent from AA. */
  curatedModels?: readonly CuratedModel[];
  /** Explicit DeepSWE configuration-to-AA identity links. */
  deepsweAliases?: readonly DeepSweAliasEntry[];
}

export interface SourceResolution {
  available: boolean;
  observedAt?: string;
}

export interface CompileStats {
  /** AA chart records emitted, including listed-frontier and scored DeepSWE records without OpenRouter pricing. */
  aaMatched: number;
  /** AA benchmark models dropped because they have no OpenRouter pricing. */
  aaUnmatched: number;
  /** OpenRouter pricing records with no AA benchmark model at this time. */
  openrouterUnmatched: number;
  /** Alias entries marked provisional referenced by this compilation. */
  provisionalAliasesUsed: number;
  cursorRecords: number;
}

export interface CompiledBundle {
  bundle: CompactBundle;
  /** The bundle serialized exactly as written to disk (deterministic). */
  json: string;
  /** Effective point in time: the newest resolved source observation. */
  asOf: string;
  requestedAsOf: string;
  sources: { aa: SourceResolution; openrouter: SourceResolution; deepswe: SourceResolution; cursor: SourceResolution };
  stats: CompileStats;
}

function toResolution(resolved: ResolvedSnapshot | undefined): SourceResolution {
  return resolved ? { available: true, observedAt: resolved.envelope.observedAt } : { available: false };
}

/**
 * Build typed AA chart records by joining AA models with OpenRouter pricing.
 * Listed-frontier models and verified DeepSWE-scored models are retained from
 * AA even when no OpenRouter row is available; this preserves source-backed
 * listed-pricing views without inventing provider or weighted prices.
 */
export function joinAaWithPricing(
  aaModels: ArtificialAnalysisModel[],
  pricing: OpenRouterModelPricing[],
  aliases: AliasFile,
  frontierSlugs: readonly string[] = [],
  curatedModels: readonly CuratedModel[] = DEFAULT_CURATED_MODELS,
  deepsweScores: readonly DeepSweScoreRecord[] = [],
  deepsweAliases: readonly DeepSweAliasEntry[] = DEFAULT_DEEPSWE_ALIASES,
): { records: DerivedAaChartRecord[]; unmatchedAa: number; unmatchedOr: number; provisionalUsed: number } {
  const aliasSlugs = new Set(aliases.entries.map((e) => e.aaModelSlug));
  const frontierSet = new Set(frontierSlugs);
  const curatedIdentities = new Set(
    curatedModels.map((model) => `${model.aaModelSlug}\u0000${model.openrouterId}`),
  );
  const provisionalSlugs = new Set(
    aliases.entries.filter((e) => e.status === "provisional").map((e) => e.aaModelSlug),
  );
  const scoreByAaSlug = new Map<string, DeepSweScoreRecord>();
  const scoreByIdentity = new Map(deepsweScores.map((score) => [deepSweScoreIdentity(score), score]));
  for (const alias of deepsweAliases) {
    const score = scoreByIdentity.get(
      `${alias.deepSweModel}\u0000${alias.harness}\u0000${alias.reasoningEffort ?? ""}`,
    );
    if (score) scoreByAaSlug.set(alias.aaModelSlug, score);
  }

  const pricingBySlug = new Map<string, OpenRouterModelPricing>();
  const pricingByOpenRouterId = new Map<string, OpenRouterModelPricing>();
  for (const record of pricing) {
    if (
      !aliasSlugs.has(record.aaModelSlug) &&
      !frontierSet.has(record.aaModelSlug) &&
      !curatedIdentities.has(`${record.aaModelSlug}\u0000${record.permaslug}`)
    ) {
      throw new Error(
        `OpenRouter pricing record for "${record.aaModelSlug}" (${record.permaslug}) is not present in the alias mapping or curated identities; refusing to price through an unsanctioned link`,
      );
    }
    pricingBySlug.set(record.aaModelSlug, record);
    pricingByOpenRouterId.set(record.permaslug, record);
  }

  let provisionalUsed = 0;
  const usedPricing = new Set<OpenRouterModelPricing>();
  const records: DerivedAaChartRecord[] = [];
  let unmatchedAa = 0;
  for (const model of aaModels) {
    // Keep non-reasoning base rows out of the browser-facing AA dataset;
    // reasoning variants remain eligible for matching and plotting.
    if (isNonReasoningModel(model.name, model.slug)) {
      unmatchedAa += 1;
      continue;
    }
    const aliasOpenRouterId = aliases.entries.find((entry) => entry.aaModelSlug === model.slug)?.openrouterId;
    // Effort rows in AA share the base OpenRouter model page. Prefer a direct
    // row, then use the mapped base identity when a snapshot only contains
    // that one shared pricing record.
    const match = pricingBySlug.get(model.slug) ?? (
      aliasOpenRouterId === undefined ? undefined : pricingByOpenRouterId.get(aliasOpenRouterId)
    );
    const deepSweScore = scoreByAaSlug.get(model.slug);
    const isValidListedFrontier = frontierSet.has(model.slug) && aaListedWorkloadCost(model) !== null;
    // A verified DeepSWE score is enough to retain an AA record. It may have
    // no current OpenRouter pricing, but AA listed pricing still supports the
    // DeepSWE score view without inventing a provider price.
    if (!match && !isValidListedFrontier && !deepSweScore) {
      unmatchedAa += 1;
      continue;
    }
    if (match && provisionalSlugs.has(model.slug)) provisionalUsed += 1;
    if (match) usedPricing.add(match);
    records.push({
      slug: model.slug,
      name: model.name,
      shortName: model.shortName,
      intelligenceIndex: model.intelligenceIndex,
      scoreSources: {
        artificialAnalysis: model.intelligenceIndex,
        ...(deepSweScore
          ? { deepSwePassAt1: deepSweScore.passAt1 }
          : {}),
      },
      canonicalTokens: {
        input: model.canonicalIntelligenceIndexTokenCount.input,
        output: model.canonicalIntelligenceIndexTokenCount.output,
      },
      providers: match?.providerSummaries ?? [],
      weighted: {
        weightedInputPrice: match?.weightedInputPrice ?? 0,
        weightedOutputPrice: match?.weightedOutputPrice ?? 0,
      },
      listed: {
        price1mInputTokens: model.price1mInputTokens,
        price1mOutputTokens: model.price1mOutputTokens,
        cacheHitPrice: model.cacheHitPrice,
      },
    });
  }

  const unmatchedOr = pricing.filter((p) => !usedPricing.has(p)).length;
  return { records, unmatchedAa, unmatchedOr, provisionalUsed };
}

function toCursorRecords(records: CursorEvalRecord[]): DerivedCursorChartRecord[] {
  return records.map((r) => ({
    modelId: r.modelId,
    modelName: r.modelName,
    provider: r.provider,
    isThirdParty: r.isThirdParty,
    score: r.score,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    publishedCostUsd: r.publishedCostUsd,
    tokensPerTask: r.tokensPerTask,
  }));
}

/**
 * Compile the derived browser bundle for one point in time. Identical inputs
 * (data-branch contents + options) produce byte-identical output.
 */
export async function compileBundle(
  store: DataBranchStore,
  options: CompileOptions,
): Promise<CompiledBundle> {
  const requestedAsOf = options.asOf ?? LATEST_AS_OF;

  // Independent per-source point-in-time resolution.
  const [aa, openrouter, deepswe, cursor] = await Promise.all([
    store.resolveSnapshot("aa", requestedAsOf),
    store.resolveSnapshot("openrouter", requestedAsOf),
    store.resolveSnapshot("deepswe", requestedAsOf),
    store.resolveSnapshot("cursor", requestedAsOf),
  ]);

  const resolutions = {
    aa: toResolution(aa),
    openrouter: toResolution(openrouter),
    deepswe: toResolution(deepswe),
    cursor: toResolution(cursor),
  };

  const observedTimes = [aa, openrouter, deepswe, cursor]
    .flatMap((r) => (r ? [r.envelope.observedAt] : []))
    .sort();
  if (observedTimes.length === 0) {
    throw new NoDataAtTimeError(
      `No aa, openrouter, deepswe, or cursor snapshot at or before ${requestedAsOf}; nothing to compile`,
    );
  }
  // Effective data time: the newest observation actually backing this view.
  const asOf = observedTimes[observedTimes.length - 1] ?? requestedAsOf;

  let aaDataset: CompactBundle["aa"] = null;
  let cursorDataset: CompactBundle["cursor"] = null;
  const stats: CompileStats = {
    aaMatched: 0,
    aaUnmatched: 0,
    openrouterUnmatched: 0,
    provisionalAliasesUsed: 0,
    cursorRecords: 0,
  };

  if (aa) {
    const aaModels = aa.envelope.records as ArtificialAnalysisModel[];
    const frontierSlugs = options.frontierSlugs ?? computeAaListedParetoFrontier(aaModels).map((model) => model.slug);
    const joined = joinAaWithPricing(
      aaModels,
      openrouter ? (openrouter.envelope.records as OpenRouterModelPricing[]) : [],
      options.aliases,
      frontierSlugs,
      options.curatedModels,
      deepswe ? (deepswe.envelope.records as DeepSweScoreRecord[]) : [],
      options.deepsweAliases,
    );
    stats.aaMatched = joined.records.length;
    stats.aaUnmatched = joined.unmatchedAa;
    stats.openrouterUnmatched = joined.unmatchedOr;
    stats.provisionalAliasesUsed = joined.provisionalUsed;
    aaDataset = encodeAaDataset({
      freshness: {
        schemaVersion: SCHEMA_VERSIONS.derived,
        asOf,
        aaObservedAt: aa.envelope.observedAt,
        ...(openrouter ? { openrouterObservedAt: openrouter.envelope.observedAt } : {}),
        ...(deepswe ? { deepsweObservedAt: deepswe.envelope.observedAt } : {}),
        ...(resolutions.cursor.available
          ? { cursorObservedAt: resolutions.cursor.observedAt as string }
          : {}),
      },
      records: joined.records,
    });
  } else if (openrouter) {
    // With no AA snapshot, every OpenRouter row is unmatched at this point in
    // time; retain that diagnostic rather than silently reporting zero.
    stats.openrouterUnmatched = openrouter.envelope.records.length;
  }

  if (cursor) {
    const records = toCursorRecords(cursor.envelope.records as CursorEvalRecord[]);
    stats.cursorRecords = records.length;
    cursorDataset = encodeCursorDataset({
      freshness: {
        schemaVersion: SCHEMA_VERSIONS.derived,
        asOf,
        ...(resolutions.aa.available ? { aaObservedAt: resolutions.aa.observedAt as string } : {}),
        ...(resolutions.openrouter.available
          ? { openrouterObservedAt: resolutions.openrouter.observedAt as string }
          : {}),
        ...(resolutions.deepswe.available
          ? { deepsweObservedAt: resolutions.deepswe.observedAt as string }
          : {}),
        cursorObservedAt: cursor.envelope.observedAt,
      },
      records,
    });
  }

  const bundle: CompactBundle = {
    v: SCHEMA_VERSIONS.derived,
    asOf,
    sources: {
      aa: encodeSourceAvailability(resolutions.aa),
      openrouter: encodeSourceAvailability(resolutions.openrouter),
      deepswe: encodeSourceAvailability(resolutions.deepswe),
      cursor: encodeSourceAvailability(resolutions.cursor),
    },
    aa: aaDataset,
    cursor: cursorDataset,
  };

  // Deterministic serialization: fixed key order (object literals), no
  // indentation, trailing newline. Identical inputs => identical bytes.
  const json = `${JSON.stringify(bundle)}\n`;

  return { bundle, json, asOf, requestedAsOf, sources: resolutions, stats };
}

/** One entry in the derived output index. */
export interface DerivedIndexEntry {
  asOf: string;
  /** File name relative to the derived output directory. */
  path: string;
  aa: boolean;
  cursor: boolean;
}

export interface DerivedIndex {
  v: number;
  entries: DerivedIndexEntry[];
}

/** Parse an existing index file's contents (undefined when absent/empty). */
export function parseDerivedIndex(raw: string | undefined): DerivedIndex {
  if (raw === undefined || raw.trim() === "") {
    return { v: SCHEMA_VERSIONS.derived, entries: [] };
  }
  const parsed = JSON.parse(raw) as DerivedIndex;
  if (parsed.v !== SCHEMA_VERSIONS.derived || !Array.isArray(parsed.entries)) {
    throw new TypeError(`Unsupported derived index (v=${String(parsed.v)})`);
  }
  return parsed;
}

/**
 * Insert/replace an entry (by asOf) and serialize the index deterministically
 * (entries sorted by asOf, fixed key order, no indentation).
 */
export function upsertDerivedIndexEntry(index: DerivedIndex, entry: DerivedIndexEntry): string {
  const entries = [...index.entries.filter((e) => e.asOf !== entry.asOf), entry].sort((a, b) =>
    a.asOf.localeCompare(b.asOf),
  );
  return `${JSON.stringify({ v: index.v, entries })}\n`;
}
