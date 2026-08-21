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

/**
 * OpenRouter's model page embeds provider pricing in a Next.js Flight payload.
 * The page publishes the discounted provider rate and an explicit fractional
 * `pricing.discount`; recover the comparable pre-discount rates without
 * treating a price ratio as evidence of a discount.
 */
export function parseOpenRouterProviderDiscounts(html: string): OpenRouterProviderDiscount[] {
  const decoded = html
    .replaceAll('\\"', '"')
    .replaceAll("\\u0026", "&")
    .replaceAll("\\u003c", "<")
    .replaceAll("\\u003e", ">");
  const providerPattern = /"provider_name":"([^"]+)"[\s\S]*?"provider_slug":"([^"]+)"[\s\S]*?"pricing":\{"prompt":"([^"]+)","completion":"([^"]+)"[\s\S]*?"discount":(0(?:\.\d+)?|1(?:\.0+)?)/g;
  const discounts: OpenRouterProviderDiscount[] = [];
  const seen = new Set<string>();

  for (const match of decoded.matchAll(providerPattern)) {
    const providerName = match[1];
    const rawProviderSlug = match[2];
    const prompt = Number(match[3]) * 1_000_000;
    const completion = Number(match[4]) * 1_000_000;
    const discountFraction = Number(match[5]);
    if (
      !providerName || !rawProviderSlug ||
      !Number.isFinite(prompt) || prompt <= 0 ||
      !Number.isFinite(completion) || completion <= 0 ||
      !Number.isFinite(discountFraction) || discountFraction <= 0 || discountFraction >= 1
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

  return discounts.sort((a, b) => a.providerSlug.localeCompare(b.providerSlug) || a.providerName.localeCompare(b.providerName));
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
