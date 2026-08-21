import {
  EFFECTIVE_PRICING_URL,
  MODEL_CATALOG_URL,
  UpstreamError,
  fetchJson,
  isEmptySkeleton,
  mapWithConcurrency,
  rawCatalogResponseSchema,
  rawEffectivePricingResponseSchema,
  resolveCanonicalSlug,
} from "./api";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import {
  type AliasEntry,
  type CatalogModel,
  curatedAliases,
  frontierAliases,
  parseAliasFile,
  provisionalAliases,
  suggestAliases,
} from "./mapping";
import type { AaFrontierIdentity } from "../aa/frontier";
import type { CuratedModel } from "./curated";
import {
  openRouterModelPricingSchema,
  openRouterSnapshotPayloadSchema,
  type OpenRouterModelPricing,
  type OpenRouterSnapshotPayload,
} from "../../schemas/openrouter";

export const OPENROUTER_SOURCE_METADATA = {
  source: "openrouter",
  endpointUrl: EFFECTIVE_PRICING_URL,
  /** Repo-relative alias file path; kept stable as the mappingRef identifier. */
  mappingRef: "src/collectors/openrouter/openrouter-aliases.json",
} as const;

/** One mapped model that could not produce a validated record. */
export interface ModelFailure {
  aaModelSlug: string;
  openrouterId: string;
  /** no-data = empty-skeleton response; unresolved = id missing from catalog; upstream = network/shape. */
  category: "no-data" | "unresolved" | "upstream";
  detail: string;
}

export interface CollectorReport {
  observedAt: string;
  mappingRef: string;
  /** Provisional (unverified-identity) aliases that produced records. */
  provisionalUsed: string[];
  /** Advisory AA slugs with exactly one obvious OpenRouter match (for human curation). */
  suggestedObvious: { aaModelSlug: string; openrouterId: string }[];
  /** Advisory AA slugs with multiple candidates; requires human curation. */
  suggestedAmbiguous: { aaModelSlug: string; candidates: string[] }[];
  /** Advisory AA slugs with no catalog match found. */
  unmatchedCatalogModels: string[];
  /** Explicit curated identities absent from the current OpenRouter catalog. */
  unmatchedCuratedModels: string[];
  /** Frontier identities that had no unique exact catalog match. */
  unmatchedFrontierModels: string[];
  records: OpenRouterModelPricing[];
  failures: ModelFailure[];
}

export interface CollectorIo {
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
}

export const nodeFs: CollectorIo = {
  readFile: (path, encoding) => readFile(path, encoding),
  writeFile: (path, data, encoding) => writeFile(path, data, encoding),
  rename: (from, to) => rename(from, to),
  mkdir: (path, options) => mkdir(path, options),
};

export interface CollectorOptions {
  aliasPath: string;
  outPath?: string;
  concurrency?: number;
  timeoutMs?: number;
  retries?: number;
  backoffBaseMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Defaults to the real Node fs (nodeFs); tests inject fakes. */
  io?: CollectorIo;
  /** Automatic AA frontier identities to include before matching/dropping. */
  frontierModels?: readonly AaFrontierIdentity[];
  /** Explicit operator-forced identities, independent of frontier selection. */
  curatedModels?: readonly CuratedModel[];
  log?: (line: string) => void;
}

/** Fail-closed collector error: carries the full categorized report. */
export class CollectorError extends Error {
  constructor(
    readonly report: CollectorReport,
  ) {
    super(
      `OpenRouter collection failed for ${report.failures.length} of ` +
        `${report.records.length + report.failures.length} mapped models ` +
        `(${report.failures.map((f) => `[${f.category}] ${f.aaModelSlug}`).join(", ")}); no snapshot written`,
    );
    this.name = "CollectorError";
  }
}

/**
 * Collect effective pricing for every mapped model and produce a fully
 * validated snapshot payload.
 *
 * Fail-closed contract: if ANY mapped model fails (unresolved id, empty
 * skeleton, upstream error, validation failure), the run throws
 * CollectorError and no output file is written — a partial snapshot can
 * never replace a known-good one.
 */
export async function collectOpenRouterPricing(
  options: CollectorOptions,
): Promise<CollectorReport> {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const io: CollectorIo = options.io ?? nodeFs;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const concurrency = options.concurrency ?? 3;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const retries = options.retries ?? 2;
  const backoffBaseMs = options.backoffBaseMs ?? 500;

  const rawAliases = await io.readFile(options.aliasPath, "utf8");
  const aliasFile = parseAliasFile(rawAliases, `alias file at ${options.aliasPath}`);
  const curated = curatedAliases(options.curatedModels ?? []);

  const fetchOptions = { timeoutMs, retries, backoffBaseMs, fetchImpl };
  const catalogResponse = await fetchJson(MODEL_CATALOG_URL, rawCatalogResponseSchema, fetchOptions);
  const perMillion = (raw: string | undefined): number | undefined => {
    if (raw === undefined) return undefined;
    const value = Number(raw) * 1_000_000;
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };
  const catalog: CatalogModel[] = catalogResponse.data.map((m) => ({
    id: m.id,
    canonicalSlug: m.canonical_slug,
    name: m.name,
    ...(m.pricing
      ? {
          listedInputPrice: perMillion(m.pricing.prompt),
          listedOutputPrice: perMillion(m.pricing.completion),
          ...(m.pricing.input_cache_read !== undefined
            ? { listedCacheReadPrice: perMillion(m.pricing.input_cache_read) }
            : {}),
          ...(m.pricing.input_cache_write !== undefined
            ? { listedCacheWritePrice: perMillion(m.pricing.input_cache_write) }
            : {}),
        }
      : {}),
  }));
  const rawCatalog = catalogResponse.data;
  const catalogById = new Map(catalog.map((model) => [model.id, model]));

  const frontier = frontierAliases(options.frontierModels ?? [], catalog);
  const catalogIds = new Set(catalog.map((model) => model.id));
  const unmatchedCuratedModels = curated
    .filter((entry) => !catalogIds.has(entry.openrouterId))
    .map((entry) => entry.aaModelSlug)
    .sort();
  // Do not admit a curated identity that the catalog cannot resolve, but keep
  // it in the run report so a missing upstream identity is never silent.
  const additions = [...frontier.entries, ...curated.filter((entry) => catalogIds.has(entry.openrouterId))];
  const existingSlugs = new Set(aliasFile.entries.map((entry) => entry.aaModelSlug));
  const uniqueAdditions = additions.filter((entry) => !existingSlugs.has(entry.aaModelSlug));
  const entries: AliasEntry[] = [...aliasFile.entries, ...uniqueAdditions];
  const effectiveAliasFile = { ...aliasFile, entries };
  const effectiveProvisionalUsed = provisionalAliases(effectiveAliasFile).map((e) => e.aaModelSlug);

  // Advisory suggestions for human curation; frontier entries are already
  // admitted above because they were selected by a deterministic rule.
  const knownAaSlugs = entries.map((e) => e.aaModelSlug);
  const suggestions = suggestAliases(knownAaSlugs, catalog);
  // AA models we do not map at all cannot be suggested from here (we only
  // know AA slugs present in the alias file), so unmatched refers to those.
  const unmatchedCatalogModels = suggestions.unmatched;

  const observedAt = now().toISOString();
  const records: OpenRouterModelPricing[] = [];
  const failures: ModelFailure[] = [];

  await mapWithConcurrency(entries, concurrency, async (entry: AliasEntry) => {
    try {
      const canonicalSlug = resolveCanonicalSlug(rawCatalog, entry.openrouterId);
      if (canonicalSlug === undefined || canonicalSlug.startsWith("~")) {
        failures.push({
          aaModelSlug: entry.aaModelSlug,
          openrouterId: entry.openrouterId,
          category: "unresolved",
          detail: `OpenRouter catalog has no resolvable canonical slug for id "${entry.openrouterId}"`,
        });
        return;
      }
      const url = `${EFFECTIVE_PRICING_URL}?permaslug=${encodeURIComponent(canonicalSlug)}&shape=v7&variant=standard`;
      const response = await fetchJson(url, rawEffectivePricingResponseSchema, fetchOptions);
      if (isEmptySkeleton(response.data)) {
        failures.push({
          aaModelSlug: entry.aaModelSlug,
          openrouterId: entry.openrouterId,
          category: "no-data",
          detail: `Empty-skeleton response for canonical slug "${canonicalSlug}" (no effective pricing data)`,
        });
        return;
      }
      const providerSummaries = response.data.providerSummaries.map((p) => ({
        providerName: p.providerName,
        providerSlug: p.providerSlug,
        effectiveInputPrice: p.effectiveInputPrice,
        effectiveOutputPrice: p.effectiveOutputPrice,
        ...(p.listedInputPrice !== undefined ? { listedInputPrice: p.listedInputPrice } : {}),
        ...(p.listedOutputPrice !== undefined ? { listedOutputPrice: p.listedOutputPrice } : {}),
        ...(p.discountPercentage !== undefined ? { discountPercentage: p.discountPercentage } : {}),
      }));
      const listed = catalogById.get(entry.openrouterId);
      const candidate = {
        permaslug: entry.openrouterId,
        aaModelSlug: entry.aaModelSlug,
        aaModelId: entry.aaModelId,
        weightedInputPrice: response.data.weightedInputPrice,
        weightedOutputPrice: response.data.weightedOutputPrice,
        providerSummaries,
        ...(listed?.listedInputPrice !== undefined ? { listedInputPrice: listed.listedInputPrice } : {}),
        ...(listed?.listedOutputPrice !== undefined ? { listedOutputPrice: listed.listedOutputPrice } : {}),
        ...(listed?.listedCacheReadPrice !== undefined
          ? { listedCacheReadPrice: listed.listedCacheReadPrice }
          : {}),
        ...(listed?.listedCacheWritePrice !== undefined
          ? { listedCacheWritePrice: listed.listedCacheWritePrice }
          : {}),
      };
      const parsed = openRouterModelPricingSchema.safeParse(candidate);
      if (!parsed.success) {
        failures.push({
          aaModelSlug: entry.aaModelSlug,
          openrouterId: entry.openrouterId,
          category: "upstream",
          detail: `Record failed shared-schema validation: ${parsed.error.message}`,
        });
        return;
      }
      records.push(parsed.data);
      log(`collected ${entry.aaModelSlug} (${canonicalSlug}): ${parsed.data.providerSummaries.length} providers`);
    } catch (error) {
      const detail = error instanceof UpstreamError
        ? error.message
        : `Unexpected error: ${String(error)}`;
      failures.push({
        aaModelSlug: entry.aaModelSlug,
        openrouterId: entry.openrouterId,
        category: "upstream",
        detail,
      });
    }
  });

  const report: CollectorReport = {
    observedAt,
    mappingRef: OPENROUTER_SOURCE_METADATA.mappingRef,
    provisionalUsed: effectiveProvisionalUsed,
    suggestedObvious: suggestions.obvious.filter(
      (s) => !effectiveAliasFile.entries.some((e) => e.aaModelSlug === s.aaModelSlug),
    ),
    suggestedAmbiguous: suggestions.ambiguous,
    unmatchedCatalogModels,
    unmatchedCuratedModels,
    unmatchedFrontierModels: [
      ...frontier.unmatched,
      ...frontier.ambiguous.map((model) => model.aaModelSlug),
    ].sort(),
    records: records.sort((a, b) => (a.aaModelSlug < b.aaModelSlug ? -1 : a.aaModelSlug > b.aaModelSlug ? 1 : 0)),
    failures,
  };

  if (failures.length > 0) {
    throw new CollectorError(report);
  }
  return report;
}

/**
 * Serialize the validated snapshot payload deterministically and write it
 * atomically (temp file + rename) so a crash mid-write cannot corrupt output.
 */
export async function writeSnapshotPayload(
  report: CollectorReport,
  outPath: string,
  io: CollectorIo = nodeFs,
): Promise<void> {
  const payload: OpenRouterSnapshotPayload = {
    observedAt: report.observedAt,
    source: { ...OPENROUTER_SOURCE_METADATA },
    records: report.records,
  };
  const validated = openRouterSnapshotPayloadSchema.parse(payload);
  const serialized = JSON.stringify(validated, null, 2) + "\n";
  const tmpPath = `${outPath}.tmp`;
  const parent = outPath.slice(0, Math.max(outPath.lastIndexOf("/"), 0)) || ".";
  await io.mkdir(parent, { recursive: true });
  await io.writeFile(tmpPath, serialized, "utf8");
  await io.rename(tmpPath, outPath);
}

export function formatReport(report: CollectorReport): string {
  const lines = [
    `OpenRouter collection @ ${report.observedAt} (mapping: ${report.mappingRef})`,
    `records: ${report.records.length}`,
  ];
  if (report.provisionalUsed.length > 0) {
    lines.push(`PROVISIONAL aliases used (unverified identity): ${report.provisionalUsed.join(", ")}`);
  }
  if (report.suggestedObvious.length > 0) {
    lines.push(
      `suggested obvious matches (review and add to the alias file): ` +
        report.suggestedObvious.map((s) => `${s.aaModelSlug} -> ${s.openrouterId}`).join("; "),
    );
  }
  if (report.suggestedAmbiguous.length > 0) {
    lines.push(
      `AMBIGUOUS matches needing human curation: ` +
        report.suggestedAmbiguous.map((s) => `${s.aaModelSlug} -> [${s.candidates.join(", ")}]`).join("; "),
    );
  }
  if (report.unmatchedCuratedModels.length > 0) {
    lines.push(`unmatched curated OpenRouter models: ${report.unmatchedCuratedModels.join(", ")}`);
  }
  if (report.unmatchedFrontierModels.length > 0) {
    lines.push(`unmatched AA frontier models: ${report.unmatchedFrontierModels.join(", ")}`);
  }
  for (const failure of report.failures) {
    lines.push(`FAILURE [${failure.category}] ${failure.aaModelSlug} (${failure.openrouterId}): ${failure.detail}`);
  }
  return lines.join("\n");
}
