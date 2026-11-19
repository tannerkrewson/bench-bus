/**
 * Artificial Analysis RSC collector.
 *
 * Fetches AA model pages, dynamically discovers the current Next.js `_rsc`
 * discriminator, extracts the inline Flight payloads, and normalizes the model
 * set into a schema-valid snapshot payload. Each AA page embeds only part of
 * the model set, so several pages are read and merged by model identity. Fails
 * closed: any parse/validation failure throws (CLI exits nonzero) and no
 * partial data is ever emitted.
 */
import { aaSnapshotPayloadSchema, type AaSnapshotPayload } from "../../schemas";
import {
  buildRscEndpoint,
  collectRawModels,
  discoverIntelligenceIndexVersion,
  discoverRscParam,
  extractFlightText,
  parseFlightRows,
  type RawAaModel,
} from "./flight";
import { buildAaCollection, type AaCollectionResult } from "./normalize";

/**
 * Model pages read on every run, in merge order; the first page supplies the
 * source metadata. Each AA model page embeds only about 28 complete models
 * around its own model (checked 2026-11-17), so one page can never cover the
 * set. These pages, one or more per vendor, together cover the current V5
 * families and their effort variants; overlaps are merged by identity.
 */
export const AA_SOURCE_PAGE_SLUGS = [
  "deepseek-v4-flash",
  // OpenAI
  "gpt-6-2-sol",
  "gpt-6-2-astra",
  "gpt-6-luna",
  "gpt-6-1-terra",
  // Anthropic
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
  "claude-fable-5-2",
  // Google
  "gemini-4-argon",
  "gemini-4-carbon",
  "gemini-4-hydrogen",
  "gemini-4-neon",
  // xAI
  "grok-4-7",
  // DeepSeek
  "deepseek-v4-pro",
  "deepseek-v4-1-flash-1017",
  // Moonshot, Xiaomi, Meta, MiniMax, Qwen, Z.ai, Mistral, NVIDIA
  "kimi-k3-1-pro",
  "mimo-v2-6-flash",
  "mimo-v2-6-pro",
  "muse-spark-1-3",
  "minimax-m3",
  "qwen3-8-max",
  "glm-5-3",
  "mistral-large-4",
  "nvidia-nemotron-3-ultra-550b-a55b",
] as const;

export function aaModelPageUrl(slug: string): string {
  return `https://artificialanalysis.ai/models/${encodeURIComponent(slug)}`;
}

export interface CollectAaOptions {
  /** Model pages to read and merge; defaults to AA_SOURCE_PAGE_SLUGS. */
  slugs?: readonly string[];
  /** Read only this start URL instead of the model pages (tests/advanced use). */
  startUrl?: string;
  /** Fetch timeout in milliseconds, per page. */
  timeoutMs?: number;
  /** Fixed observation timestamp (deterministic tests); defaults to now. */
  observedAt?: string;
  /** Dependency-injected fetch (tests); defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

/** One fetched AA page: its start URL and raw HTML. */
export interface AaPage {
  startUrl: string;
  html: string;
}

export interface CollectAaResult {
  payload: AaSnapshotPayload;
  /** Frontier identities computed from the same normalized AA collection. */
  frontier: AaCollectionResult["frontier"];
  stats: Omit<AaCollectionResult, "records" | "frontier">;
  /** Start URLs of every page merged into the payload, in merge order. */
  startUrls: string[];
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
 * Run the full collection pipeline against several already-fetched pages.
 * Records from every page are merged by identity (first page wins), so a model
 * listed on several pages is kept once. Pages must share one Intelligence
 * Index generation, so history is never merged across index versions.
 * `observedAt` defaults to the current time; tests pass a fixed value so
 * output is fully deterministic.
 */
export function collectFromPages(
  pages: readonly AaPage[],
  observedAt: string = new Date().toISOString(),
): CollectAaResult {
  const first = pages[0];
  if (!first) throw new Error("No Artificial Analysis pages to collect");

  const rawModels: RawAaModel[] = [];
  const versions = new Set<string>();
  let rscEndpoint = first.startUrl;
  for (const [index, page] of pages.entries()) {
    const flightText = extractFlightText(page.html);
    const version = discoverIntelligenceIndexVersion(flightText);
    if (version) versions.add(version);
    if (index === 0) rscEndpoint = buildRscEndpoint(page.startUrl, discoverRscParam(page.html));
    for (const row of parseFlightRows(flightText)) {
      rawModels.push(...collectRawModels(row.value));
    }
  }
  if (versions.size > 1) {
    throw new Error(
      `Artificial Analysis pages report different Intelligence Index versions ` +
        `(${[...versions].join(", ")}); refusing to merge across index generations.`,
    );
  }
  const [intelligenceIndexVersion] = [...versions];

  const collection = buildAaCollection(rawModels);
  const payload = aaSnapshotPayloadSchema.parse({
    observedAt,
    source: {
      source: "aa" as const,
      startUrl: first.startUrl,
      rscEndpoint,
      ...(intelligenceIndexVersion ? { intelligenceIndexVersion } : {}),
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
    startUrls: pages.map((page) => page.startUrl),
  };
}

/**
 * Run the full collection pipeline against one already-fetched page.
 * `observedAt` defaults to the current time; tests pass a fixed value so
 * output is fully deterministic.
 */
export function collectFromHtml(
  html: string,
  startUrl: string,
  observedAt: string = new Date().toISOString(),
): CollectAaResult {
  return collectFromPages([{ startUrl, html }], observedAt);
}

/** Collect a full AA snapshot payload from the live site. */
export async function collectAa(options: CollectAaOptions = {}): Promise<CollectAaResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const startUrls = options.startUrl
    ? [options.startUrl]
    : [...new Set(options.slugs ?? AA_SOURCE_PAGE_SLUGS)].map(aaModelPageUrl);
  const pages: AaPage[] = [];
  for (const startUrl of startUrls) {
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
    pages.push({ startUrl, html: await response.text() });
  }
  return collectFromPages(pages, options.observedAt);
}
