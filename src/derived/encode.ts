import {
  derivedAaChartRecordSchema,
  derivedCursorChartRecordSchema,
  freshnessMetadataSchema,
  SCHEMA_VERSIONS,
  type DerivedAaChartRecord,
  type DerivedCursorChartRecord,
  type FreshnessMetadata,
} from "../schemas";

/**
 * Compact wire encoding for derived browser datasets.
 *
 * GOAL: the browser bundle should carry exactly what the charts consume, in
 * the fewest bytes, while raw archival snapshots stay on the data branch.
 *
 * ENCODING (this file is the single source of truth for it):
 *
 * - Top-level bundle object with SHORT KEYS:
 *     `v`      derived schema version (SCHEMA_VERSIONS.derived)
 *     `asOf`   effective point in time (max resolved source observedAt)
 *     `sources` per-source availability: `["1", observedAt]` when a snapshot
 *              at/before asOf exists, `0` when it does not (no fabrication)
 *     `aa`     compact AA dataset or `null` (null = pricing unavailable or
 *              AA benchmark data unavailable at asOf)
 *     `cursor` compact Cursor dataset or `null`
 *
 * - Each dataset is `{ f, m }`:
 *     `f`  freshness tuple `[aaObservedAt, openrouterObservedAt, cursorObservedAt]`
 *          where an entry is the source's observation time or `null` when no
 *          eligible snapshot exists for that source at `asOf` (it contributes
 *          no data to that dataset; nothing is fabricated)
 *     `m`  array of positional records (below) sorted by identity key.
 *
 * - AA record tuple (positional, mirrors DerivedAaChartRecord):
 *     `[slug, name, shortName, intelligenceIndex,
 *       [canonicalInputTokens, canonicalOutputTokens],
 *       [[providerName, providerSlug, effectiveInputPrice, effectiveOutputPrice,
 *         listedInputPrice|null, listedOutputPrice|null, discountPercentage|null,
 *         undiscountedModelId|null], ...],
 *       [weightedInputPrice, weightedOutputPrice],
 *       [price1mInputTokens, price1mOutputTokens, cacheHitPrice]]`
 *
 * - Cursor record tuple (mirrors DerivedCursorChartRecord):
 *     `[modelId, modelName, provider, isThirdParty (0|1), score,
 *       inputTokens|null, outputTokens|null, publishedCostUsd|null,
 *       tokensPerTask|null]`
 *
 * The decoder is browser-safe (no Node built-ins) and validates every decoded
 * record against the shared zod contracts, so an encoding drift fails loudly
 * instead of mispricing models.
 */

/** Per-source availability: resolved snapshot time, or unavailable. */
export type CompactSourceAvailability = ["1", string] | 0;

export function encodeSourceAvailability(available: {
  available: boolean;
  observedAt?: string;
}): CompactSourceAvailability {
  return available.available && available.observedAt !== undefined
    ? ["1", available.observedAt]
    : 0;
}

export interface CompactBundle {
  v: number;
  asOf: string;
  sources: {
    aa: CompactSourceAvailability;
    openrouter: CompactSourceAvailability;
    cursor: CompactSourceAvailability;
  };
  aa: CompactDataset | null;
  cursor: CompactDataset | null;
}

/** `{ f, m }` dataset with positional records; record shape differs per chart. */
export interface CompactDataset {
  /** Freshness tuple; an entry is the source's observedAt or null when unavailable. */
  f: [string | null, string | null, string | null];
  /** Positional record tuples (AA or Cursor shape); validated on decode. */
  m: unknown[];
}

type CompactAaRecord = [
  string, // slug
  string, // name
  string, // shortName
  number, // intelligenceIndex
  [number, number], // canonicalTokens [input, output]
  Array<
    | [string, string, number, number]
    | [string, string, number, number, number | null, number | null, number | null, string | null]
  >, // providers
  [number, number], // weighted
  [number, number, number], // listed
];

type CompactCursorRecord = [
  string, // modelId
  string, // modelName
  string, // provider
  0 | 1, // isThirdParty
  number, // score
  number | null, // inputTokens
  number | null, // outputTokens
  number | null, // publishedCostUsd
  number | null, // tokensPerTask
];

export function encodeAaDataset(
  dataset: { freshness: FreshnessMetadata; records: DerivedAaChartRecord[] } | null,
): CompactDataset | null {
  if (!dataset) return null;
  return {
    f: [
      dataset.freshness.aaObservedAt ?? null,
      dataset.freshness.openrouterObservedAt ?? null,
      dataset.freshness.cursorObservedAt ?? null,
    ],
    m: dataset.records.map(
      (r): CompactAaRecord => [
        r.slug,
        r.name,
        r.shortName,
        r.intelligenceIndex,
        [r.canonicalTokens.input, r.canonicalTokens.output],
        r.providers.map((p) => {
          const hasDiscountMetadata =
            p.listedInputPrice !== undefined ||
            p.listedOutputPrice !== undefined ||
            p.discountPercentage !== undefined ||
            p.undiscountedModelId !== undefined;
          return hasDiscountMetadata
            ? [
                p.providerName,
                p.providerSlug,
                p.effectiveInputPrice,
                p.effectiveOutputPrice,
                p.listedInputPrice ?? null,
                p.listedOutputPrice ?? null,
                p.discountPercentage ?? null,
                p.undiscountedModelId ?? null,
              ]
            : [p.providerName, p.providerSlug, p.effectiveInputPrice, p.effectiveOutputPrice];
        }),
        [r.weighted.weightedInputPrice, r.weighted.weightedOutputPrice],
        [r.listed.price1mInputTokens, r.listed.price1mOutputTokens, r.listed.cacheHitPrice],
      ],
    ),
  };
}

export function encodeCursorDataset(
  dataset: { freshness: FreshnessMetadata; records: DerivedCursorChartRecord[] } | null,
): CompactDataset | null {
  if (!dataset) return null;
  return {
    f: [
      dataset.freshness.aaObservedAt ?? null,
      dataset.freshness.openrouterObservedAt ?? null,
      dataset.freshness.cursorObservedAt ?? null,
    ],
    m: dataset.records.map(
      (r): CompactCursorRecord => [
        r.modelId,
        r.modelName,
        r.provider,
        r.isThirdParty ? 1 : 0,
        r.score,
        r.inputTokens ?? null,
        r.outputTokens ?? null,
        r.publishedCostUsd ?? null,
        r.tokensPerTask ?? null,
      ],
    ),
  };
}

function decodeFreshness(bundleAsOf: string, f: unknown) {
  if (!Array.isArray(f) || f.length !== 3) {
    throw new TypeError(`Invalid freshness tuple: ${JSON.stringify(f)}`);
  }
  const [aaObservedAt, openrouterObservedAt, cursorObservedAt] = f;
  for (const entry of [aaObservedAt, openrouterObservedAt, cursorObservedAt]) {
    if (entry !== null && typeof entry !== "string") {
      throw new TypeError(`Invalid freshness tuple: ${JSON.stringify(f)}`);
    }
  }
  return freshnessMetadataSchema.parse({
    schemaVersion: SCHEMA_VERSIONS.derived,
    asOf: bundleAsOf,
    ...(typeof aaObservedAt === "string" ? { aaObservedAt } : {}),
    ...(typeof openrouterObservedAt === "string" ? { openrouterObservedAt } : {}),
    ...(typeof cursorObservedAt === "string" ? { cursorObservedAt } : {}),
  });
}

function decodeAvailability(raw: unknown): { available: boolean; observedAt?: string } {
  if (raw === 0) return { available: false };
  if (Array.isArray(raw) && raw.length === 2 && raw[0] === "1" && typeof raw[1] === "string") {
    return { available: true, observedAt: raw[1] };
  }
  throw new TypeError(`Invalid source availability encoding: ${JSON.stringify(raw)}`);
}

/** Decoded, schema-validated view of a compact bundle for the browser. */
export interface DecodedBundle {
  asOf: string;
  sources: {
    aa: { available: boolean; observedAt?: string };
    openrouter: { available: boolean; observedAt?: string };
    cursor: { available: boolean; observedAt?: string };
  };
  aa: { freshness: ReturnType<typeof decodeFreshness>; records: DerivedAaChartRecord[] } | null;
  cursor: { freshness: ReturnType<typeof decodeFreshness>; records: DerivedCursorChartRecord[] } | null;
}

/**
 * Decode a compact bundle back into schema-valid datasets. Throws on any
 * structural mismatch so a broken build never reaches the charts silently.
 */
export function decodeBundle(raw: unknown): DecodedBundle {
  if (typeof raw !== "object" || raw === null) {
    throw new TypeError("Derived bundle must be a JSON object");
  }
  const bundle = raw as Record<string, unknown>;
  if (bundle.v !== SCHEMA_VERSIONS.derived) {
    throw new TypeError(`Unsupported derived bundle version: ${String(bundle.v)}`);
  }
  if (typeof bundle.asOf !== "string") {
    throw new TypeError("Derived bundle is missing asOf");
  }
  const asOf = bundle.asOf;
  if (typeof bundle.sources !== "object" || bundle.sources === null) {
    throw new TypeError("Derived bundle is missing sources availability");
  }
  const sourcesRaw = bundle.sources as Record<string, unknown>;
  const sources = {
    aa: decodeAvailability(sourcesRaw.aa),
    openrouter: decodeAvailability(sourcesRaw.openrouter),
    cursor: decodeAvailability(sourcesRaw.cursor),
  };

  const decodeAa = (dataset: unknown) => {
    if (dataset === null) return null;
    if (typeof dataset !== "object" || dataset === null) {
      throw new TypeError("Invalid aa dataset");
    }
    const { f, m } = dataset as { f: unknown; m: unknown };
    if (!Array.isArray(m)) throw new TypeError("Invalid aa records array");
    const records = m.map((row) => {
      if (!Array.isArray(row) || row.length !== 8) {
        throw new TypeError(`Invalid compact AA record: ${JSON.stringify(row)}`);
      }
      const [slug, name, shortName, intelligenceIndex, tokens, providers, weighted, listed] = row as CompactAaRecord;
      if (!Array.isArray(tokens) || !Array.isArray(providers) || !Array.isArray(weighted) || !Array.isArray(listed)) {
        throw new TypeError(`Invalid compact AA record structure: ${slug}`);
      }
      return derivedAaChartRecordSchema.parse({
        slug,
        name,
        shortName,
        intelligenceIndex,
        canonicalTokens: { input: tokens[0], output: tokens[1] },
        providers: providers.map((p) => ({
          providerName: p[0],
          providerSlug: p[1],
          effectiveInputPrice: p[2],
          effectiveOutputPrice: p[3],
          ...(p.length >= 7 && p[4] !== null ? { listedInputPrice: p[4] } : {}),
          ...(p.length >= 7 && p[5] !== null ? { listedOutputPrice: p[5] } : {}),
          ...(p.length >= 7 && p[6] !== null ? { discountPercentage: p[6] } : {}),
          ...(p.length >= 8 && p[7] !== null ? { undiscountedModelId: p[7] } : {}),
        })),
        weighted: { weightedInputPrice: weighted[0], weightedOutputPrice: weighted[1] },
        listed: {
          price1mInputTokens: listed[0],
          price1mOutputTokens: listed[1],
          cacheHitPrice: listed[2],
        },
      });
    });
    return { freshness: decodeFreshness(asOf, f), records };
  };

  const decodeCursor = (dataset: unknown) => {
    if (dataset === null) return null;
    if (typeof dataset !== "object" || dataset === null) {
      throw new TypeError("Invalid cursor dataset");
    }
    const { f, m } = dataset as { f: unknown; m: unknown };
    if (!Array.isArray(m)) throw new TypeError("Invalid cursor records array");
    const records = m.map((row) => {
      if (!Array.isArray(row) || row.length !== 9) {
        throw new TypeError(`Invalid compact Cursor record: ${JSON.stringify(row)}`);
      }
      const [modelId, modelName, provider, third, score, inputTokens, outputTokens, publishedCostUsd, tokensPerTask] =
        row as CompactCursorRecord;
      return derivedCursorChartRecordSchema.parse({
        modelId,
        modelName,
        provider,
        isThirdParty: third === 1,
        score,
        ...(inputTokens !== null ? { inputTokens } : {}),
        ...(outputTokens !== null ? { outputTokens } : {}),
        ...(publishedCostUsd !== null ? { publishedCostUsd } : {}),
        ...(tokensPerTask !== null ? { tokensPerTask } : {}),
      });
    });
    return { freshness: decodeFreshness(asOf, f), records };
  };

  return {
    asOf: bundle.asOf,
    sources,
    aa: decodeAa(bundle.aa),
    cursor: decodeCursor(bundle.cursor),
  };
}
