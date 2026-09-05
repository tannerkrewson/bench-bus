/** One provider endpoint published on an OpenRouter model page. */
export interface OpenRouterProviderEndpoint {
  /** OpenRouter endpoint UUID, which also appears in effective-pricing rows. */
  endpointId: string;
  providerName: string;
  providerSlug: string;
  /** OpenRouter service tier, such as `flex` or `priority`. */
  serviceTier?: string;
  /** Provider's published USD price per 1M tokens. */
  listedInputPrice?: number;
  listedOutputPrice?: number;
  /** Explicit fractional discount published by OpenRouter, when present. */
  discountFraction?: number;
}

/** A provider discount explicitly published in an OpenRouter model page. */
export interface OpenRouterProviderDiscount {
  providerName: string;
  /** Stable provider slug; variant suffixes are removed for matching. */
  providerSlug: string;
  /** Provider's pre-discount USD price per 1M tokens, derived from the published rate and discount. */
  listedInputPrice: number;
  listedOutputPrice: number;
  /** Explicit OpenRouter discount percentage, not inferred from two prices. */
  discountPercentage: number;
}

export interface OpenRouterProviderPageMetadata {
  endpoints: OpenRouterProviderEndpoint[];
  discounts: OpenRouterProviderDiscount[];
}

/**
 * OpenRouter's model page embeds provider pricing in a Next.js Flight payload.
 * The page publishes the discounted provider rate and an explicit fractional
 * `pricing.discount`; recover the comparable pre-discount rates without
 * treating a price ratio as evidence of a discount.
 */
function decodeFlightPayload(html: string): string {
  return html
    .replaceAll('\\"', '"')
    .replaceAll("\\u0026", "&")
    .replaceAll("\\u003c", "<")
    .replaceAll("\\u003e", ">");
}

function finitePositive(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Parse endpoint metadata from the model page's Next.js Flight payload.
 * Endpoint UUIDs are the stable join key shared with effective-pricing rows;
 * provider names alone are ambiguous when a provider exposes standard, Flex,
 * and priority routes for the same model.
 */
export function parseOpenRouterProviderEndpoints(html: string): OpenRouterProviderEndpoint[] {
  const decoded = decodeFlightPayload(html);
  const endpointStartPattern = /"id":"([^"]+)","name":"([^"]+\s\|\s[^"]+)"/g;
  const starts = [...decoded.matchAll(endpointStartPattern)];
  const endpoints: OpenRouterProviderEndpoint[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]!;
    const endpointId = start[1]!;
    if (seen.has(endpointId)) continue;
    seen.add(endpointId);
    const block = decoded.slice(start.index!, starts[index + 1]?.index ?? decoded.length);
    const providerName = block.match(/"provider_name":"([^"]+)"/)?.[1];
    const providerSlug = block.match(/"provider_slug":"([^"]+)"/)?.[1];
    if (providerName === undefined || providerSlug === undefined) continue;
    const serviceTier = block.match(/"service_tier":"([^"]+)"/)?.[1];
    const pricing = block.match(
      /"pricing":\{"prompt":"([^"]+)","completion":"([^"]+)"[\s\S]*?"discount":(0(?:\.\d+)?|1(?:\.0+)?)/,
    );
    const pricesWithoutDiscount = block.match(
      /"pricing":\{"prompt":"([^"]+)","completion":"([^"]+)"/,
    );
    const prompt = finitePositive(pricing?.[1] ?? pricesWithoutDiscount?.[1]);
    const completion = finitePositive(pricing?.[2] ?? pricesWithoutDiscount?.[2]);
    const rawDiscount = pricing?.[3];
    const discountFraction = rawDiscount === undefined ? undefined : Number(rawDiscount);
    endpoints.push({
      endpointId,
      providerName,
      providerSlug,
      ...(serviceTier !== undefined ? { serviceTier } : {}),
      ...(prompt !== undefined ? { listedInputPrice: prompt * 1_000_000 } : {}),
      ...(completion !== undefined ? { listedOutputPrice: completion * 1_000_000 } : {}),
      ...(discountFraction !== undefined && Number.isFinite(discountFraction)
        ? { discountFraction }
        : {}),
    });
  }

  return endpoints.sort((a, b) => a.endpointId.localeCompare(b.endpointId));
}

/**
 * OpenRouter's model page embeds provider pricing in a Next.js Flight payload.
 * The page publishes the discounted provider rate and an explicit fractional
 * `pricing.discount`; recover the comparable pre-discount rates without
 * treating a price ratio as evidence of a discount.
 */
export function parseOpenRouterProviderDiscounts(html: string): OpenRouterProviderDiscount[] {
  const decoded = decodeFlightPayload(html);
  const discounts: OpenRouterProviderDiscount[] = [];
  const seen = new Set<string>();

  const endpoints = parseOpenRouterProviderEndpoints(html);
  for (const endpoint of endpoints) {
    const providerName = endpoint.providerName;
    const rawProviderSlug = endpoint.providerSlug;
    const prompt = endpoint.listedInputPrice;
    const completion = endpoint.listedOutputPrice;
    const discountFraction = endpoint.discountFraction;
    if (
      !providerName || !rawProviderSlug || prompt === undefined || completion === undefined ||
      discountFraction === undefined || discountFraction <= 0 || discountFraction >= 1
    ) continue;
    const providerSlug = rawProviderSlug.split("/")[0] ?? rawProviderSlug;
    const key = `${providerSlug}\u0000${providerName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    discounts.push({
      providerName,
      providerSlug,
      listedInputPrice: prompt / (1 - discountFraction),
      listedOutputPrice: completion / (1 - discountFraction),
      discountPercentage: discountFraction * 100,
    });
  }

  // Keep accepting the small provider-only fragments used by older callers
  // and fixtures; full model pages use the endpoint-aware parser above.
  if (endpoints.length === 0) {
    const providerPattern = /"provider_name":"([^"]+)"[\s\S]*?"provider_slug":"([^"]+)"[\s\S]*?"pricing":\{"prompt":"([^"]+)","completion":"([^"]+)"[\s\S]*?"discount":(0(?:\.\d+)?|1(?:\.0+)?)/g;
    for (const match of decoded.matchAll(providerPattern)) {
      const prompt = finitePositive(match[3]);
      const completion = finitePositive(match[4]);
      const discountFraction = Number(match[5]);
      if (
        prompt === undefined || completion === undefined ||
        !Number.isFinite(discountFraction) || discountFraction <= 0 || discountFraction >= 1
      ) continue;
      const providerSlug = match[2]!.split("/")[0] ?? match[2]!;
      const key = `${providerSlug}\u0000${match[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      discounts.push({
        providerName: match[1]!,
        providerSlug,
        listedInputPrice: (prompt * 1_000_000) / (1 - discountFraction),
        listedOutputPrice: (completion * 1_000_000) / (1 - discountFraction),
        discountPercentage: discountFraction * 100,
      });
    }
  }

  return discounts.sort((a, b) => a.providerSlug.localeCompare(b.providerSlug) || a.providerName.localeCompare(b.providerName));
}

/** Fetch and parse all provider metadata from one model page in one request. */
export async function fetchOpenRouterProviderMetadata(
  openrouterId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<OpenRouterProviderPageMetadata> {
  const response = await fetchImpl(`https://openrouter.ai/${openrouterId}`, {
    headers: { Accept: "text/html", "User-Agent": "Bench Bus pricing collector" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return { endpoints: [], discounts: [] };
  const html = await response.text();
  return {
    endpoints: parseOpenRouterProviderEndpoints(html),
    discounts: parseOpenRouterProviderDiscounts(html),
  };
}

/** Fetch endpoint/service-tier metadata from one OpenRouter model page. */
export async function fetchOpenRouterProviderEndpoints(
  openrouterId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<OpenRouterProviderEndpoint[]> {
  return (await fetchOpenRouterProviderMetadata(openrouterId, fetchImpl, timeoutMs)).endpoints;
}

/** Fetch official provider discount metadata from one OpenRouter model page. */
export async function fetchOpenRouterProviderDiscounts(
  openrouterId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<OpenRouterProviderDiscount[]> {
  const response = await fetchImpl(`https://openrouter.ai/${openrouterId}`, {
    headers: { Accept: "text/html", "User-Agent": "Bench Bus pricing collector" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return [];
  return parseOpenRouterProviderDiscounts(await response.text());
}
