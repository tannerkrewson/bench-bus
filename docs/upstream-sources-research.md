# Research: Scraping Artificial Analysis, OpenRouter effective pricing, and Cursor evals (2026)

## Summary
All three sources are verifiable as of 2026-08. Artificial Analysis model pages are Next.js App Router pages whose full model dataset (including `canonicalIntelligenceIndexTokenCount`) is embedded server-side in RSC Flight payloads (`self.__next_f.push` scripts) inside the HTML — no `?_rsc=` request needed for a first load; a paid Data API also exists. OpenRouter's `effective-pricing` frontend endpoint is public and unauthenticated but **only returns data when given the canonical slug with date suffix** (e.g. `anthropic/claude-opus-5-20260723`); short permaslugs return an empty-but-200 skeleton. Cursor's CursorBench page is fully server-rendered HTML + an SSR'd inline SVG chart, with the same content mirrored in embedded RSC flight scripts; no separate JSON endpoint was found and no third-party surcharge field appears on the page.

## Findings

### 1. Artificial Analysis (artificialanalysis.ai)

1. **Confirmed Next.js App Router site with RSC Flight payloads embedded in HTML.** Raw fetch of `https://artificialanalysis.ai/models/claude-opus-5` returns ~3.3 MB of SSR HTML containing hundreds of `<script>self.__next_f.push([1,"..."])</script>` blocks — standard React Flight format: lines keyed by short hex-ish IDs (`a1:I[8279,["60048","static/chunks/..."],...,"Providers"]`, `9d:["$","$La1",null,{...}]`, text chunks `ac:Td8d,`, `["$","span",...]` element arrays, `$L`/`$` references). [Fetched raw, 2026-08-21]

2. **The `?_rsc=<hash>` mechanism.** `_rsc` is Next.js's internal client-router cache discriminator; it appears on prefetch/RSC navigations and must always be sent together with the `RSC: 1` request header. The hash is ephemeral — it is not a stable token you can construct; for a first-page load you don't need it at all because the Flight payload is already inline in the HTML `self.__next_f.push` scripts. To replay an RSC navigation you must capture the exact URL + headers from a browser. [Next.js CDN caching docs: https://nextjs.org/docs/app/guides/cdn-caching]

3. **Model object field names — verified verbatim from the embedded payload** (sampled at offset ~1.5 MB of the claude-opus-5 HTML; the page embeds a large array of ALL models, not just the page's model). Exact camelCase names observed:
   - Identity: `id` (UUID), `slug`, `name`, `shortName`, `releaseDate` (ISO date), `knowledgeCutoffDate`, `isReasoning`, `reasoningTokens`, `release: {slug, name}`, `effort: {slug, label, level}`, `deprecated`, `deprecatedTo`, `isOpenWeights`, `openSourceCategorization`, `parameters`, `inferenceParametersActiveBillions`, `sizeClass`, `contextWindowTokens`, `licenseName`, `licenseUrl`, `modelWeightsSourceUrl`, `microevalsEnabled`, `hostModelCount`
   - Pricing (camelCase, NOT `price_1m_input_tokens`): `price1mInputTokens`, `price1mOutputTokens`, `cacheHitPrice`, `cacheHitDiscountPercent`, `cacheWritePrice`, `pricePer1k1mpImages`, blended prices `price1mBlended0To3To1`, `price1mBlended7To2To1`, `price1mBlended0To1To1`, `price1mBlended100To1To1`, `price1mBlended0To100To1` (USD per 1M tokens)
   - Benchmarks: `intelligenceIndex` (float), `intelligenceIndexIsEstimated`, `agenticIndex`, `omniscience` + `omniscienceBreakdown {accuracy, hallucinationRate}`, `gdpval` + `gdpvalNormalized`, `itBenchSre`, `tau2`, `tauBanking`, `terminalbenchHard`, `terminalbenchV21`, `scicode`, `lcr`, `ifbench`, `hle`, `gpqa`, `critpt`, `apexAgents`, `mmmuPro`, `livecodebench`, `aime25`, `briefcaseBreakdown`, `briefcaseTotalCost`
   - **`canonicalIntelligenceIndexTokenCount` — CONFIRMED, exact name**: `{"input":810078135,"output":114542834,"answer":7383942,"reasoning":107158892}` (seen on Nemotron 3 Super). Companion fields: `intelligenceIndexOutputTokensPerTask: {reasoning, answer, output}`, `intelligenceIndexTimePerTask`, `intelligenceIndexCost: {total, input, nonCacheInput, cacheRead, cacheWrite, output, reasoning, answer}`, `intelligenceIndexCostPerTask: {cost:{...}, evaluations:[{slug, weightedCostPerTask}]}`
   - Perf: `timescaleData {medianOutputSpeed, medianTimeToFirstChunk}`, `outputSpeedVariance {p05,q25,median,q75,p95}`, `timeToFirstChunkVariance`, `performanceByPromptType {medium,long,hundredK,mediumParallel}`, `endToEndResponseTime {input,reasoning,answer,total}`, `timeToFirstAnswerToken {input,reasoning,total}`, `performanceDataSource {type: "median"|"firstParty", providerName}`, `creator {id,slug,name,logo,color,country,url}`, `openness {opennessIndex, ...}`
   - Note: `canonicalIntelligenceIndexTokenCount` and `intelligenceIndexCostPerTask` appear only on models with full (non-estimated) Intelligence Index runs; many models have `null` for them.

4. **Public API exists (keyed).** `GET https://artificialanalysis.ai/api/v2/language/models` (full) and `/api/v2/language/models/free` (public subset, paginated) and `/api/v2/language/models/{slug}` (with `prompt_type` param), auth via `x-api-key` header; docs at https://artificialanalysis.ai/data-api/docs. Free tier requires a free account/API key. [AA Data API docs]

### 2. OpenRouter

5. **`GET https://openrouter.ai/api/frontend/v1/stats/effective-pricing` is publicly accessible without auth** (no API key, no cookies; plain curl worked). Undocumented — not in OpenRouter's public API reference; it powers the "Effective Pricing" charts on model pages. No rate-limit headers/documentation found; treat as unofficial and throttle conservatively. [Fetched 2026-08-21; OpenRouter docs confirm it's not in the API reference]

6. **CRITICAL: the `permaslug` must be the canonical slug with date suffix.** With `permaslug=anthropic/claude-opus-4.5`, `openai/gpt-5.6-sol`, `google/gemini-3.7-flash`, `z-ai/glm-5.3`, and even `anthropic/claude-opus-5`, the endpoint returns HTTP 200 with an **empty skeleton** (all zeros / empty arrays). With `permaslug=anthropic/claude-opus-5-20260723` it returns full data. `shape=v7&variant=standard` params were accepted (untested whether optional).

7. **Response shape — exact field names verified** (per-M-token USD prices):
   ```
   data: {
     weightedInputPrice: 1.2714..., weightedOutputPrice: 25.0038..., weightedCacheHitRate: 0.8485,
     providerSummaries: [{ endpointId, providerName, providerSlug, effectiveInputPrice, effectiveOutputPrice, cacheHitRate, totalTokens }],
     providerNames: ["Azure (US)", ...],
     endpointNames: { <endpointId>: "<display name>" },
     endpointRawNames: { <endpointId>: "<raw name>" },
     endpointProviderSlugs: { <endpointId>: "<provider slug>" },
     inputChartData: [{ x: "2026-08-14 00:00:00", y: { <endpointId>: price } }],
     outputChartData: [ ... same shape ... ]
   }
   ```
   All requested fields (`weightedInputPrice`, `weightedOutputPrice`, `providerSummaries[].providerName`, `.providerSlug`, `.effectiveInputPrice`, `.effectiveOutputPrice`) confirmed exactly as named.

8. **Permaslug format & listing.** `GET https://openrouter.ai/api/v1/models` is public/unauthenticated (685 KB JSON) and lists every model. IDs look like `vendor/model` (`anthropic/claude-opus-5`), variant suffixes `:free`/`:batch` (`anthropic/claude-opus-5:batch`, `nvidia/...:free`), alias redirects prefixed `~` (`~z-ai/glm-latest`), and `canonical_slug` adds a date: `anthropic/claude-opus-5-20260723`. Model objects include `id`, `canonical_slug`, `name`, `created`, `context_length`, `architecture`, `pricing {prompt, completion, input_cache_read, input_cache_write, ...}` (per-token USD strings), `top_provider`, `supported_parameters`, `reasoning`, and for many models `benchmarks.artificial_analysis {intelligence_index, coding_index, agentic_index}` and `benchmarks.design_arena[]`. To hit effective-pricing, map `id → canonical_slug` from this list first.

### 3. Cursor evals (cursor.com/evals → canonical `cursor.com/cursorbench`)

9. **Page is a Next.js App Router page, fully server-rendered.** Raw HTML (336 KB) contains: (a) an inline `<svg class="cursorbench-chart">` scatter chart with every data point as a `<g class="cursorbench-chart__point-group" aria-label="Grok 4.6 Extra High: 70.8%, $2.81 avg cost per task">` — machine-readable values in aria-labels; (b) an SSR'd HTML `<table>` with columns: rank (implicit), **Model**, **Score** (%), **Cost / task** ($), **Tokens / task**, **Steps / task**; sortable via header buttons. [Fetched raw, 2026-08-21]

10. **Embedded JSON = RSC flight payload, not `__NEXT_DATA__`.** No `__NEXT_DATA__` script exists. Data is in `self.__next_f.push([1,"..."])` scripts (App Router flight). However, the benchmark rows themselves live in the SSR'd HTML/SVG; the flight payload for the main section mostly references client components (`$L1d`, `$L1e`...), with the changelog and footer fully serialized in flight. No separate JSON/XHR endpoint for table data was found in the HTML; the page appears to ship data at build/SSR time.

11. **Table contents verified** (56 rows, CursorBench 3.2): model name includes effort level ("Opus 5 Max", "GPT-5.6 Luna Low"), score %, avg cost/task, avg tokens/task, steps/task. Chart x-axis toggles Cost / Tokens / Steps. Footnote: "Avg cost / task is computed by applying each model's published per-million-token pricing (input, cache read, cache write, and output)…". Changelog section with dated entries (latest Aug 11, 2026). **No evidence found on the page of a "$0.25/M third-party model surcharge" field or per-benchmark cost breakdown** — that would live in Cursor's pricing docs, not this page (unverified here).

## Sources
- Kept: AA model page raw HTML (https://artificialanalysis.ai/models/claude-opus-5) — primary evidence for RSC payload + exact model field names
- Kept: AA Data API docs (https://artificialanalysis.ai/data-api/docs) — official keyed API
- Kept: OpenRouter effective-pricing endpoint (live responses, canonical vs short slug) — primary evidence for shape + slug requirement
- Kept: OpenRouter /api/v1/models (live) — permaslug/canonical_slug format
- Kept: cursor.com/evals raw HTML — SSR table, SVG chart aria-labels, flight payload
- Kept: Next.js CDN caching guide (https://nextjs.org/docs/app/guides/cdn-caching) — `_rsc` + `RSC` header semantics
- Dropped: SEO/blog commentary on RSC scraping — superseded by primary Next.js docs and direct observation

## Gaps
- Could not verify whether `shape`/`variant` params on OpenRouter effective-pricing are required or what other values exist (v7/standard worked; untested alternatives).
- No public rate-limit documentation for OpenRouter's frontend endpoint; abuse thresholds unknown.
- AA's `?_rsc=` RSC-navigation replay was not tested live (only the inline-payload path was verified); the `_rsc` hash generation is undocumented.
- Cursor: no JSON endpoint found for CursorBench data; whether one exists behind the client bundle was not determined. The $0.25/M third-party surcharge was not found on the evals page (may exist in cursor.com/pricing or /docs/models-and-pricing — not fetched).
- AA model-page payload embeds ALL models, but I sampled one slice; field presence may vary per model (estimated vs measured indices).

## Collector implementation notes

**Artificial Analysis** — Best strategy: fetch `https://artificialanalysis.ai/models/<slug>` as plain HTML and extract the `self.__next_f.push([1,"..."])` scripts; concatenate the string fragments, then locate the big model array by searching for `"canonicalIntelligenceIndexTokenCount"` / `"price1mInputTokens"` and JSON-decode the surrounding structure (or use a Flight parser like `flight-stream`-style decoders). Avoid `?_rsc=` replay entirely for first loads. Risks: 3.3 MB pages (heavy); payload format is internal Next.js/React Flight and can change with framework upgrades; field names are undocumented and can be renamed without notice; consider the free-tier Data API (`/api/v2/language/models/free`) as a more stable fallback, though it may not include `canonicalIntelligenceIndexTokenCount`.

**OpenRouter** — Best strategy: pull `GET /api/v1/models` once to build `id → canonical_slug` map, then `GET /api/frontend/v1/stats/effective-pricing?permaslug=<canonical_slug>&shape=v7&variant=standard` per model. Always check for the empty-skeleton response (weightedInputPrice === 0 && providerSummaries.length === 0) and treat it as "no data for this slug", not an error. Risks: undocumented endpoint — could change or require auth without notice; no published rate limits (add backoff, low QPS); short permaslugs silently return 200-with-empty-data (the main correctness trap); prices are realized 30-day averages including cache discounts, not list prices.

**Cursor evals** — Best strategy: fetch `https://cursor.com/evals` HTML and parse (a) the `<table>` rows (rank/model/score/cost/tokens/steps in fixed column order) and/or (b) the SVG point groups' `aria-label` attributes, which encode `"Model: score%, $cost avg cost per task"` in a stable, regex-friendly format. Risks: purely presentational markup — class names (`cursorbench-chart__*`, theme utility classes) and column order can change on redesign; values are display-rounded (e.g. 70.8%, $2.81); no JSON fallback identified, so a redesign forces a parser rewrite; page is Vercel-deployed with per-deploy asset hashes (harmless for HTML scraping).

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings written to /var/home/tannerkrewson/code/bench-bus/research.md: exact AA field names (price1mInputTokens, canonicalIntelligenceIndexTokenCount{input,output,answer,reasoning}) verified from raw HTML; OpenRouter effective-pricing shape (weightedInputPrice, providerSummaries[].providerName/providerSlug/effectiveInputPrice/effectiveOutputPrice) verified from live responses plus the canonical-slug requirement; Cursor evals SSR table/SVG structure verified from raw HTML."
    }
  ],
  "changedFiles": [
    "research.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "fetch_content (raw) artificialanalysis.ai/models/claude-opus-5",
      "result": "passed",
      "summary": "3.3MB Next.js App Router HTML with RSC flight payload; model schema incl. canonicalIntelligenceIndexTokenCount found"
    },
    {
      "command": "fetch_content (raw) openrouter.ai/api/frontend/v1/stats/effective-pricing?permaslug=anthropic/claude-opus-5-20260723&shape=v7&variant=standard",
      "result": "passed",
      "summary": "Unauthenticated 200 with full providerSummaries data; short permaslugs return empty skeleton"
    },
    {
      "command": "fetch_content (raw) openrouter.ai/api/v1/models",
      "result": "passed",
      "summary": "Public model catalog; permaslug/canonical_slug format confirmed"
    },
    {
      "command": "fetch_content (raw) cursor.com/evals",
      "result": "passed",
      "summary": "SSR HTML table + inline SVG chart with aria-label data points; RSC flight scripts, no __NEXT_DATA__"
    },
    {
      "command": "web_search (AA API, _rsc mechanism, OpenRouter endpoint docs)",
      "result": "passed",
      "summary": "AA Data API docs and Next.js _rsc/RSC-header semantics confirmed; effective-pricing confirmed undocumented"
    }
  ],
  "validationOutput": [
    "All live endpoints fetched successfully 2026-08-21; no blocked fetches"
  ],
  "residualRisks": [
    "OpenRouter effective-pricing is undocumented; shape/auth could change without notice",
    "AA and Cursor extraction depends on internal Next.js Flight format and CSS/aria markup that may change on redesign",
    "Cursor $0.25/M third-party surcharge not found on evals page; unverified",
    "AA ?_rsc= navigation replay not tested live; only inline-payload path verified"
  ],
  "noStagedFiles": true,
  "diffSummary": "Added research.md with verified findings for three scraping targets",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "Key trap discovered: OpenRouter effective-pricing requires canonical date-suffixed slug (e.g. anthropic/claude-opus-5-20260723); short permaslugs return HTTP 200 with empty data."
}
```