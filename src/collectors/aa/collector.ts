/**
 * Artificial Analysis RSC collector.
 *
 * Fetches a normal AA model page, dynamically discovers the current Next.js
 * `_rsc` discriminator, extracts the inline Flight payload, and normalizes
 * the complete model set into a schema-valid snapshot payload. Fails closed:
 * any parse/validation failure throws (CLI exits nonzero) and no partial
 * data is ever emitted.
 */
import { aaSnapshotPayloadSchema, type AaSnapshotPayload } from "../../schemas";
import {
  buildRscEndpoint,
  collectRawModels,
  discoverRscParam,
  extractFlightText,
  parseFlightRows,
} from "./flight";
import { buildAaCollection, type AaCollectionResult } from "./normalize";

export const AA_DEFAULT_MODEL_SLUG = "deepseek-v4-flash";
/** Curated AA records retained even when AA has no cache-write rate. */
export const AA_CURATED_MODEL_SLUGS = ["deepseek-v4-flash"] as const;

export function aaModelPageUrl(slug: string): string {
  return `https://artificialanalysis.ai/models/${encodeURIComponent(slug)}`;
}

export interface CollectAaOptions {
  /** Model page to start discovery from. */
  slug?: string;
  /** Override the start URL entirely (tests/advanced use). */
  startUrl?: string;
  /** Fetch timeout in milliseconds. */
  timeoutMs?: number;
  /** Fixed observation timestamp (deterministic tests); defaults to now. */
  observedAt?: string;
  /** Dependency-injected fetch (tests); defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export interface CollectAaResult {
  payload: AaSnapshotPayload;
  /** Frontier identities computed from the same normalized AA collection. */
  frontier: AaCollectionResult["frontier"];
  stats: Omit<AaCollectionResult, "records" | "frontier">;
}

/** Fetch the model page HTML with a hard timeout and a browser-like UA. */
export async function fetchModelPage(url: string, timeoutMs = 30_000): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Fetching ${url} failed: HTTP ${response.status}`);
  }
  return response.text();
}

/**
 * Run the full collection pipeline against already-fetched page HTML.
 * `observedAt` defaults to the current time; tests pass a fixed value so
 * output is fully deterministic.
 */
export function collectFromHtml(
  html: string,
  startUrl: string,
  observedAt: string = new Date().toISOString(),
): CollectAaResult {
  const rscParam = discoverRscParam(html);
  const flightText = extractFlightText(html);
  const rows = parseFlightRows(flightText);
  const rawModels = rows.flatMap((row) => collectRawModels(row.value));
  const collection = buildAaCollection(rawModels, {
    allowNullCacheWriteSlugs: AA_CURATED_MODEL_SLUGS,
  });
  const payload = aaSnapshotPayloadSchema.parse({
    observedAt,
    source: {
      source: "aa" as const,
      startUrl,
      rscEndpoint: buildRscEndpoint(startUrl, rscParam),
    },
    records: collection.records,
  });
  return {
    payload,
    frontier: collection.frontier,
    stats: {
      rawCount: collection.rawCount,
      incompleteCount: collection.incompleteCount,
      duplicateCount: collection.duplicateCount,
    },
  };
}

/** Collect a full AA snapshot payload from the live site. */
export async function collectAa(options: CollectAaOptions = {}): Promise<CollectAaResult> {
  const startUrl = options.startUrl ?? aaModelPageUrl(options.slug ?? AA_DEFAULT_MODEL_SLUG);
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(startUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Fetching ${startUrl} failed: HTTP ${response.status}`);
  }
  const html = await response.text();
  return collectFromHtml(html, startUrl, options.observedAt);
}
