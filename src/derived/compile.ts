import {
  SCHEMA_VERSIONS,
  type ArtificialAnalysisModel,
  type CursorEvalRecord,
  type DerivedAaChartRecord,
  type DerivedCursorChartRecord,
  type OpenRouterModelPricing,
} from "../schemas";
import type { DataBranchStore, ResolvedSnapshot } from "../snapshots/store";
import type { AliasFile } from "../collectors/openrouter/mapping";
import { computeAaListedParetoFrontier } from "../collectors/aa/frontier";
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
 *   requested time is reported unavailable. The AA chart dataset requires
 *   BOTH the AA benchmark snapshot and OpenRouter pricing; without OpenRouter
 *   pricing the AA dataset is null (pricing unavailable) rather than emitted
 *   with invented or empty pricing.
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
   * an OpenRouter pricing record whose aaModelSlug is not in the mapping
   * fails the build (mapping integrity), rather than silently pricing a
   * model through an unsanctioned link.
   */
  aliases: AliasFile;
  /** Optional precomputed frontier identities; defaults to the AA snapshot. */
  frontierSlugs?: readonly string[];
}

export interface SourceResolution {
  available: boolean;
  observedAt?: string;
}

export interface CompileStats {
  /** AA models matched to OpenRouter pricing and emitted. */
  aaMatched: number;
  /** AA benchmark models dropped because no OpenRouter pricing was mapped. */
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
  sources: { aa: SourceResolution; openrouter: SourceResolution; cursor: SourceResolution };
  stats: CompileStats;
}

function toResolution(resolved: ResolvedSnapshot | undefined): SourceResolution {
  return resolved ? { available: true, observedAt: resolved.envelope.observedAt } : { available: false };
}

/** Build typed AA chart records by joining AA models with OpenRouter pricing. */
export function joinAaWithPricing(
  aaModels: ArtificialAnalysisModel[],
  pricing: OpenRouterModelPricing[],
  aliases: AliasFile,
  frontierSlugs: readonly string[] = [],
): { records: DerivedAaChartRecord[]; unmatchedAa: number; unmatchedOr: number; provisionalUsed: number } {
  const aliasSlugs = new Set(aliases.entries.map((e) => e.aaModelSlug));
  const frontierSet = new Set(frontierSlugs);
  const provisionalSlugs = new Set(
    aliases.entries.filter((e) => e.status === "provisional").map((e) => e.aaModelSlug),
  );

  const pricingBySlug = new Map<string, OpenRouterModelPricing>();
  for (const record of pricing) {
    if (!aliasSlugs.has(record.aaModelSlug) && !frontierSet.has(record.aaModelSlug)) {
      throw new Error(
        `OpenRouter pricing record for "${record.aaModelSlug}" (${record.permaslug}) is not present in the alias mapping; refusing to price through an unsanctioned link`,
      );
    }
    pricingBySlug.set(record.aaModelSlug, record);
  }

  let provisionalUsed = 0;
  const records: DerivedAaChartRecord[] = [];
  let unmatchedAa = 0;
  for (const model of aaModels) {
    const match = pricingBySlug.get(model.slug);
    if (!match) {
      unmatchedAa += 1;
      continue;
    }
    if (provisionalSlugs.has(model.slug)) provisionalUsed += 1;
    records.push({
      slug: model.slug,
      name: model.name,
      shortName: model.shortName,
      intelligenceIndex: model.intelligenceIndex,
      canonicalTokens: {
        input: model.canonicalIntelligenceIndexTokenCount.input,
        output: model.canonicalIntelligenceIndexTokenCount.output,
      },
      providers: match.providerSummaries,
      weighted: {
        weightedInputPrice: match.weightedInputPrice,
        weightedOutputPrice: match.weightedOutputPrice,
      },
      listed: {
        price1mInputTokens: model.price1mInputTokens,
        price1mOutputTokens: model.price1mOutputTokens,
        cacheHitPrice: model.cacheHitPrice,
      },
    });
  }

  const matchedSlugs = new Set(records.map((r) => r.slug));
  const unmatchedOr = pricing.filter((p) => !matchedSlugs.has(p.aaModelSlug)).length;
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
  const [aa, openrouter, cursor] = await Promise.all([
    store.resolveSnapshot("aa", requestedAsOf),
    store.resolveSnapshot("openrouter", requestedAsOf),
    store.resolveSnapshot("cursor", requestedAsOf),
  ]);

  const resolutions = {
    aa: toResolution(aa),
    openrouter: toResolution(openrouter),
    cursor: toResolution(cursor),
  };

  const observedTimes = [aa, openrouter, cursor]
    .flatMap((r) => (r ? [r.envelope.observedAt] : []))
    .sort();
  if (observedTimes.length === 0) {
    throw new NoDataAtTimeError(
      `No aa, openrouter, or cursor snapshot at or before ${requestedAsOf}; nothing to compile`,
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

  if (aa && openrouter) {
    const aaModels = aa.envelope.records as ArtificialAnalysisModel[];
    const frontierSlugs = options.frontierSlugs ?? computeAaListedParetoFrontier(aaModels).map((model) => model.slug);
    const joined = joinAaWithPricing(
      aaModels,
      openrouter.envelope.records as OpenRouterModelPricing[],
      options.aliases,
      frontierSlugs,
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
        openrouterObservedAt: openrouter.envelope.observedAt,
        ...(resolutions.cursor.available
          ? { cursorObservedAt: resolutions.cursor.observedAt as string }
          : {}),
      },
      records: joined.records,
    });
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
