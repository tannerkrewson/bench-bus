import { describe, expect, it } from "vitest";
import { collectAa, collectFromHtml } from "./collector";
import { buildRscEndpoint, discoverRscParam, extractFlightText } from "./flight";
import { buildAaCollection } from "./normalize";
import { parseFlightRows } from "./flight";
import aaPageHtml from "./fixtures/aa-page.html?raw";
import brokenInvariantHtml from "./fixtures/aa-page-broken-invariant.html?raw";
import noModelsHtml from "./fixtures/aa-page-no-models.html?raw";
import notFlightHtml from "./fixtures/aa-page-not-flight.html?raw";

const OBSERVED_AT = "2026-08-21T00:00:00.000Z";
const START_URL = "https://artificialanalysis.ai/models/claude-opus-5";

describe("extractFlightText", () => {
  it("concatenates split self.__next_f.push fragments in document order", () => {
    const html = aaPageHtml;
    const flight = extractFlightText(html);
    // The models row is split across three push fragments mid-JSON; after
    // concatenation it must parse as a complete row.
    expect(flight).toContain('"canonicalIntelligenceIndexTokenCount"');
    expect(() => extractFlightText("<html><body>none</body></html>")).toThrow(
      /No Next.js Flight payloads/,
    );
  });
});

describe("discoverRscParam", () => {
  it("dynamically discovers the current _rsc value from page URLs (not hard-coded)", () => {
    const html = aaPageHtml;
    expect(discoverRscParam(html)).toBe("1x9kq2f");

    // A different deployed discriminator must be discovered, proving the
    // value comes from the page rather than a constant.
    const rotated = html.replace("_rsc=1x9kq2f", "_rsc=n3w7ok3n");
    expect(discoverRscParam(rotated)).toBe("n3w7ok3n");

    // First loads may ship no prefetch URLs; discovery degrades to null and
    // the collector falls back to the inline-payload path.
    expect(discoverRscParam("<html><head></head><body></body></html>")).toBeNull();
  });

  it("builds the RSC endpoint from the discovered param, or falls back to the start URL", () => {
    expect(buildRscEndpoint(START_URL, "1x9kq2f")).toBe(
      `${START_URL}?_rsc=1x9kq2f`,
    );
    expect(buildRscEndpoint(START_URL, null)).toBe(START_URL);
  });
});

describe("parseFlightRows", () => {
  it("parses JSON rows and skips text chunks and module references", () => {
    const rows = parseFlightRows(
      [
        '4:"$Sreact.fragment"',
        '5:I[44924,["60048","static/chunks/60048.js"],"Providers"]',
        'ab:T2a,Some descriptive text chunk',
        'aa:[{"slug":"a"}]',
      ].join("\n"),
    );
    // Kept: only the aa:[...] models row. Module-reference rows (5:I[...])
    // start with an "I" prefix (not JSON) and are correctly skipped, as are
    // the 4: string row and the ab: text chunk.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toEqual([{ slug: "a" }]);
  });
});

describe("collectFromHtml", () => {
  it("extracts, dedupes, and normalizes the complete model set from a fixture page", async () => {
    const html = aaPageHtml;
    const { payload, stats, frontier } = collectFromHtml(html, START_URL, OBSERVED_AT);

    // 3 complete models survive: incomplete (null counts, missing price) and
    // the duplicate claude-opus-5 entry are discarded.
    expect(payload.records.map((r) => r.slug)).toEqual([
      "claude-opus-5",
      "gpt-5-6-luna-low",
      "gpt-5-6-sol-low",
    ]);
    // rawCount: 3 complete + missing-price + duplicate (the null-counts
    // "estimated index" model is not even a raw candidate — the detector
    // requires non-null canonicalIntelligenceIndexTokenCount).
    expect(stats).toEqual({ rawCount: 5, incompleteCount: 1, duplicateCount: 1 });

    // Source metadata records the dynamically discovered RSC endpoint.
    expect(payload.source).toEqual({
      source: "aa",
      startUrl: START_URL,
      rscEndpoint: `${START_URL}?_rsc=1x9kq2f`,
    });
    expect(payload.observedAt).toBe(OBSERVED_AT);
    expect(frontier).toEqual(collectFromHtml(html, START_URL, OBSERVED_AT).frontier);
  });

  it("preserves upstream numeric values exactly (no rounding or recomputation)", async () => {
    const html = aaPageHtml;
    const { payload } = collectFromHtml(html, START_URL, OBSERVED_AT);
    const claude = payload.records.find((r) => r.slug === "claude-opus-5")!;
    expect(claude.intelligenceIndex).toBe(63.0532452071291);
    expect(claude.price1mInputTokens).toBe(5);
    expect(claude.price1mOutputTokens).toBe(25);
    expect(claude.cacheHitPrice).toBe(0.5);
    expect(claude.cacheWritePrice).toBe(6.25);
    expect(claude.intelligenceIndexCost.total).toBe(3836.05454152768);
    const tokens = claude.canonicalIntelligenceIndexTokenCount;
    expect(tokens.input).toBe(1_775_990_851);
    expect(tokens.output).toBe(101_179_533);
    expect(tokens.answer).toBe(16_969_565);
    expect(tokens.reasoning).toBe(84_209_968);

    // Second model: fractional prices and token counts also round-trip exactly.
    const luna = payload.records.find((r) => r.slug === "gpt-5-6-luna-low")!;
    expect(luna.price1mInputTokens).toBe(0.2);
    expect(luna.intelligenceIndexCost.total).toBe(13.73935755422428);
    expect(luna.canonicalIntelligenceIndexTokenCount.input).toBe(108_471_271);
    expect(luna.canonicalIntelligenceIndexTokenCount.output).toBe(
      luna.canonicalIntelligenceIndexTokenCount.answer +
        luna.canonicalIntelligenceIndexTokenCount.reasoning,
    );
  });

  it("produces byte-identical JSON for identical inputs (deterministic output)", async () => {
    const html = aaPageHtml;
    const first = collectFromHtml(html, START_URL, OBSERVED_AT).payload;
    const second = collectFromHtml(html, START_URL, OBSERVED_AT).payload;
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("fail-closed behavior", () => {
  it("rejects a page whose model violates output === answer + reasoning", async () => {
    const html = brokenInvariantHtml;
    expect(() => collectFromHtml(html, START_URL, OBSERVED_AT)).toThrow(
      /failed validation[\s\S]*canonicalIntelligenceIndexTokenCount[\s\S]*output/,
    );
  });

  it("fails closed when the payload shape changes and no models are found", async () => {
    const html = noModelsHtml;
    expect(() => collectFromHtml(html, START_URL, OBSERVED_AT)).toThrow(
      /No complete Artificial Analysis models/,
    );
  });

  it("fails closed when the page has no Flight payload at all", async () => {
    const html = notFlightHtml;
    expect(() => collectFromHtml(html, START_URL, OBSERVED_AT)).toThrow(
      /No Next.js Flight payloads/,
    );
  });
});

describe("buildAaCollection", () => {
  it("retains a curated model with a source-null cache-write price", () => {
    const model = {
      id: "deepseek-id",
      slug: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash 0731",
      shortName: "DeepSeek V4 Flash 0731 (max)",
      releaseDate: "2026-07-31",
      price1mInputTokens: 0.44,
      price1mOutputTokens: 1.32,
      cacheHitPrice: 0.014,
      cacheWritePrice: null,
      intelligenceIndex: 51.7665776089032,
      intelligenceIndexCost: { total: 323.25907280569834 },
      canonicalIntelligenceIndexTokenCount: {
        input: 1_280_997_079,
        output: 205_996_513,
        answer: 10_185_879,
        reasoning: 195_810_634,
      },
    };
    expect(() => buildAaCollection([model])).toThrow(/No complete Artificial Analysis models/);
    const result = buildAaCollection([model], { allowNullCacheWriteSlugs: [model.slug] });
    expect(result.records[0]?.cacheWritePrice).toBeNull();
  });

  it("keeps the first occurrence when deduplicating by identity key", () => {
    const complete = (id: string) => ({
      id,
      slug: "same-slug",
      name: "Model",
      shortName: "M",
      releaseDate: "2026-01-01",
      price1mInputTokens: 1,
      price1mOutputTokens: 2,
      cacheHitPrice: 0.1,
      cacheWritePrice: 1.1,
      intelligenceIndex: 50,
      intelligenceIndexCost: { total: 3 },
      canonicalIntelligenceIndexTokenCount: { input: 10, output: 6, answer: 2, reasoning: 4 },
    });
    const result = buildAaCollection([complete("id-a"), complete("id-b")]);
    expect(result.records).toHaveLength(1);
    expect(result.duplicateCount).toBe(1);
  });
});

describe("collectAa (end-to-end with injected fetch)", () => {
  it("produces a schema-valid snapshot payload from a fixture response", async () => {
    const html = aaPageHtml;
    const fetchImpl = (async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
    const { payload } = await collectAa({ startUrl: START_URL, observedAt: OBSERVED_AT, fetchImpl });
    expect(payload.records).toHaveLength(3);
    expect(payload.source.rscEndpoint).toContain("_rsc=1x9kq2f");
  });

  it("fails closed (throws) when the upstream fetch returns an HTTP error", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    await expect(
      collectAa({ startUrl: START_URL, fetchImpl }),
    ).rejects.toThrow(/HTTP 503/);
  });
});
