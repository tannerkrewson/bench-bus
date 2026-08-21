import { z, type ZodType } from "zod";

/**
 * Raw shapes from OpenRouter's public endpoints. These are intentionally
 * non-strict (upstream adds fields without notice); the strict contracts are
 * the shared schemas in src/schemas, applied after normalization.
 */

export const rawProviderSummarySchema = z.object({
  endpointId: z.string(),
  providerName: z.string(),
  providerSlug: z.string(),
  effectiveInputPrice: z.number(),
  effectiveOutputPrice: z.number(),
  cacheHitRate: z.number().optional(),
  totalTokens: z.number().optional(),
});

export const rawEffectivePricingDataSchema = z.object({
  weightedInputPrice: z.number(),
  weightedOutputPrice: z.number(),
  weightedCacheHitRate: z.number().optional(),
  providerSummaries: z.array(rawProviderSummarySchema),
});

export type RawEffectivePricingData = z.infer<typeof rawEffectivePricingDataSchema>;

export const rawEffectivePricingResponseSchema = z.object({
  data: rawEffectivePricingDataSchema,
});

export const rawCatalogModelSchema = z.object({
  id: z.string(),
  canonical_slug: z.string(),
  name: z.string(),
});

export const rawCatalogResponseSchema = z.object({
  data: z.array(rawCatalogModelSchema),
});

export const EFFECTIVE_PRICING_URL =
  "https://openrouter.ai/api/frontend/v1/stats/effective-pricing";
export const MODEL_CATALOG_URL = "https://openrouter.ai/api/v1/models";

/** Error thrown for definitive upstream failures (after retries are exhausted). */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Deterministic failures (bad payload shape, 4xx) must not burn retries. */
    readonly retryable = true,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export interface FetchJsonOptions {
  timeoutMs: number;
  retries: number;
  backoffBaseMs: number;
  fetchImpl: typeof fetch;
  /** Test seam: replaces setTimeout so backoff tests stay instant. */
  delay?: (ms: number) => Promise<void>;
}

const defaultDelay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * GET a JSON URL with a hard per-attempt timeout and retries with exponential
 * backoff on network errors, 429, and 5xx. Non-retryable statuses (404, other
 * 4xx) throw immediately. Retries are exhausted -> UpstreamError (fail closed).
 */
export async function fetchJson<T>(
  url: string,
  schema: ZodType<T>,
  options: FetchJsonOptions,
): Promise<T> {
  const delay = options.delay ?? defaultDelay;
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    if (attempt > 0) {
      await delay(options.backoffBaseMs * 2 ** (attempt - 1));
    }
    try {
      const response = await options.fetchImpl(url, {
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: { accept: "application/json" },
      });
      if (response.status === 429 || response.status >= 500) {
        lastError = new UpstreamError(
          `GET ${url} failed with status ${response.status}`,
          response.status,
        );
        continue;
      }
      if (!response.ok) {
        throw new UpstreamError(
          `GET ${url} failed with non-retryable status ${response.status}`,
          response.status,
          false,
        );
      }
      const parsed = schema.safeParse(await response.json());
      if (!parsed.success) {
        throw new UpstreamError(
          `GET ${url} returned an unexpected payload shape: ${parsed.error.message}`,
          undefined,
          false,
        );
      }
      return parsed.data;
    } catch (error) {
      // Deterministic failures propagate immediately; everything else retries.
      if (error instanceof UpstreamError && !error.retryable) {
        throw error;
      }
      lastError = error;
    }
  }
  throw new UpstreamError(
    `GET ${url} failed after ${options.retries + 1} attempts: ${String(lastError)}`,
  );
}

/**
 * The effective-pricing endpoint returns HTTP 200 with an all-zero/empty
 * skeleton when the permaslug has no data (notably for non-canonical slugs).
 * That must be surfaced explicitly, never persisted as real pricing.
 */
export function isEmptySkeleton(data: RawEffectivePricingData): boolean {
  return (
    data.providerSummaries.length === 0 &&
    data.weightedInputPrice === 0 &&
    data.weightedOutputPrice === 0
  );
}

/** Resolve the canonical date-suffixed permaslug for a stable OpenRouter id. */
export function resolveCanonicalSlug(
  catalog: readonly { id: string; canonical_slug: string }[],
  id: string,
): string | undefined {
  return catalog.find((m) => m.id === id)?.canonical_slug;
}

/** Run `fn` over `items` with at most `limit` concurrent executions, preserving input order in results. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`Concurrency limit must be a positive integer, got ${limit}`);
  }
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
