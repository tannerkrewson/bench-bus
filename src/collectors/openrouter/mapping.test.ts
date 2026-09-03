import { describe, expect, it } from "vitest";
import {
  AliasFileError,
  curatedAliases,
  frontierAliases,
  loadAliasFile,
  parseAliasFile,
  provisionalAliases,
  suggestAliases,
  type CatalogModel,
} from "./mapping";
import aliasSeed from "./openrouter-aliases.json";

const VALID_ENTRY = {
  aaModelSlug: "claude-opus-5",
  aaModelId: "claude-opus-5",
  openrouterId: "anthropic/claude-opus-5",
  status: "confirmed" as const,
};

function catalog(...ids: string[]): CatalogModel[] {
  return ids.map((id) => ({ id, canonicalSlug: `${id}-20260101`, name: id }));
}

describe("alias file validation", () => {
  it("accepts the committed seed mapping file", () => {
    const file = parseAliasFile(JSON.stringify(aliasSeed), "seed");
    expect(file.entries.length).toBeGreaterThanOrEqual(5);
    expect(file.entries.every((e) => e.aaModelSlug && e.openrouterId.includes("/"))).toBe(true);
    expect(file.entries.find((e) => e.aaModelSlug === "muse-spark-1-2")).toMatchObject({
      aaModelId: "04ee6719-0327-463b-a1a1-70a6a78254f9",
      openrouterId: "meta/muse-spark-1.2-contributor",
      undiscountedOpenrouterId: "meta/muse-spark-1.2",
    });
    expect(file.entries.find((e) => e.aaModelSlug === "glm-5-3-flash")).toMatchObject({
      aaModelId: "19496b81-9f41-4214-a77a-1df803b3c5ae",
      openrouterId: "z-ai/glm-5.3-flash",
    });
    expect(file.entries.find((e) => e.aaModelSlug === "deepseek-v4-pro")).toMatchObject({
      openrouterId: "deepseek/deepseek-v4-pro-0813",
    });
    expect(file.entries.find((e) => e.aaModelSlug === "grok-4-6-medium")).toMatchObject({
      aaModelId: "26614164-6840-4e17-a65a-2deb2fe7e87b",
      openrouterId: "x-ai/grok-4.6",
    });
  });

  it("rejects variant-suffixed or alias openrouter ids", () => {
    expect(() =>
      parseAliasFile(
        JSON.stringify({
          version: 1,
          entries: [{ ...VALID_ENTRY, openrouterId: "anthropic/claude-opus-5:batch" }],
        }),
      ),
    ).toThrow(AliasFileError);
    expect(() =>
      parseAliasFile(
        JSON.stringify({
          version: 1,
          entries: [{ ...VALID_ENTRY, openrouterId: "~anthropic/claude-opus-5" }],
        }),
      ),
    ).toThrow(AliasFileError);
  });

  it("rejects duplicate aaModelSlug entries", () => {
    expect(() =>
      parseAliasFile(JSON.stringify({ version: 1, entries: [VALID_ENTRY, VALID_ENTRY] })),
    ).toThrow(/duplicate/);
  });

  it("allows effort variants to share one OpenRouter base-model identity", () => {
    expect(() =>
      parseAliasFile(
        JSON.stringify({
          version: 1,
          entries: [VALID_ENTRY, { ...VALID_ENTRY, aaModelSlug: "claude-opus-5-high" }],
        }),
      ),
    ).not.toThrow();
  });

  it("fails closed when the file cannot be read", () => {
    expect(() => loadAliasFile("/nonexistent.json", () => {
      throw new Error("ENOENT");
    })).toThrow(AliasFileError);
  });
});

describe("suggestAliases", () => {
  it("suggests an obvious match for exactly one basename hit", () => {
    const result = suggestAliases(["claude-opus-5"], catalog("anthropic/claude-opus-5"));
    expect(result.obvious).toEqual([
      { aaModelSlug: "claude-opus-5", openrouterId: "anthropic/claude-opus-5" },
    ]);
    expect(result.ambiguous).toEqual([]);
    expect(result.unmatched).toEqual([]);
  });

  it("surfaces ambiguity instead of guessing when multiple exact candidates exist", () => {
    const result = suggestAliases(["some-model"], catalog("vendor/some-model", "other/some-model"));
    expect(result.obvious).toEqual([]);
    expect(result.ambiguous).toEqual([
      {
        aaModelSlug: "some-model",
        candidates: ["other/some-model", "vendor/some-model"],
      },
    ]);
  });

  it("prefers a unique exact basename match over near-miss variants", () => {
    const result = suggestAliases(
      ["deepseek-v4-pro"],
      catalog("deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-pro-0813"),
    );
    expect(result.obvious).toEqual([
      { aaModelSlug: "deepseek-v4-pro", openrouterId: "deepseek/deepseek-v4-pro" },
    ]);
    expect(result.ambiguous).toEqual([]);
  });

  it("matches dotted release numbers and effort variants to one base identity", () => {
    const result = suggestAliases(
      ["claude-fable-5-1", "claude-fable-5-1-high"],
      catalog("anthropic/claude-fable-5.1"),
    );
    expect(result.obvious).toEqual([
      { aaModelSlug: "claude-fable-5-1", openrouterId: "anthropic/claude-fable-5.1" },
      { aaModelSlug: "claude-fable-5-1-high", openrouterId: "anthropic/claude-fable-5.1" },
    ]);
    expect(result.ambiguous).toEqual([]);
    expect(result.unmatched).toEqual([]);
  });

  it("keeps normalized separator collisions ambiguous", () => {
    const result = suggestAliases(
      ["model-5-1"],
      catalog("vendor/model.5.1", "other/model_5_1"),
    );
    expect(result.obvious).toEqual([]);
    expect(result.ambiguous).toEqual([
      { aaModelSlug: "model-5-1", candidates: ["other/model_5_1", "vendor/model.5.1"] },
    ]);
  });

  it("reports unmatched AA slugs", () => {
    const result = suggestAliases(["totally-unknown-model"], catalog("anthropic/claude-opus-5"));
    expect(result.unmatched).toEqual(["totally-unknown-model"]);
  });

  it("ignores variant and alias catalog entries as suggestion candidates", () => {
    const result = suggestAliases(
      ["claude-opus-5"],
      catalog("anthropic/claude-opus-5", "anthropic/claude-opus-5:batch", "~anthropic/claude-opus-5"),
    );
    expect(result.obvious.map((s) => s.openrouterId)).toEqual(["anthropic/claude-opus-5"]);
  });
});

describe("frontier and curated aliases", () => {
  it("admits a uniquely matched frontier identity before unmatched models are dropped", () => {
    const result = frontierAliases(
      [{ slug: "frontier", id: "aa-frontier" }, { slug: "missing", id: "aa-missing" }],
      catalog("vendor/frontier"),
    );
    expect(result.entries).toEqual([expect.objectContaining({
      aaModelSlug: "frontier",
      aaModelId: "aa-frontier",
      openrouterId: "vendor/frontier",
      status: "provisional",
    })]);
    expect(result.unmatched).toEqual(["missing"]);
  });

  it("automatically selects a unique contributor tier with its base comparison", () => {
    const result = frontierAliases(
      [{ slug: "muse-spark-1-3-xhigh", id: "aa-muse-1-3" }],
      [
        {
          id: "meta/muse-spark-1.3",
          canonicalSlug: "meta/muse-spark-1.3-20260902",
          name: "Meta: Muse Spark 1.3",
          listedInputPrice: 1.25,
          listedOutputPrice: 4.25,
        },
        {
          id: "meta/muse-spark-1.3-contributor",
          canonicalSlug: "meta/muse-spark-1.3-contributor-20260902",
          name: "Meta: Muse Spark 1.3 Contributor",
          listedInputPrice: 0.1,
          listedOutputPrice: 0.2,
        },
      ],
    );

    expect(result.entries).toEqual([expect.objectContaining({
      aaModelSlug: "muse-spark-1-3-xhigh",
      openrouterId: "meta/muse-spark-1.3-contributor",
      undiscountedOpenrouterId: "meta/muse-spark-1.3",
      status: "provisional",
    })]);
  });

  it("does not guess when multiple contributor tiers share a base", () => {
    const result = frontierAliases(
      [{ slug: "muse-spark-1-3-xhigh", id: "aa-muse-1-3" }],
      catalog("meta/muse-spark-1.3", "meta/muse-spark-1.3-contributor", "other/muse-spark-1.3-contributor"),
    );

    expect(result.entries[0]).toMatchObject({ openrouterId: "meta/muse-spark-1.3" });
    expect(result.entries[0]).not.toHaveProperty("undiscountedOpenrouterId");
  });

  it("preserves explicit forced curated identity and note", () => {
    expect(curatedAliases([{
      aaModelSlug: "deepseek-v4-flash",
      aaModelId: "fe4c0848-e284-4e52-a79d-cdc28392f1a9",
      openrouterId: "deepseek/deepseek-v4-flash-0731",
      note: "forced",
    }])).toEqual([expect.objectContaining({
      aaModelSlug: "deepseek-v4-flash",
      openrouterId: "deepseek/deepseek-v4-flash-0731",
      note: "forced",
    })]);
  });
});

describe("provisionalAliases", () => {
  it("flags unverified identities for run-report surfacing", () => {
    const file = parseAliasFile(
      JSON.stringify({
        version: 1,
        entries: [
          VALID_ENTRY,
          { ...VALID_ENTRY, aaModelSlug: "grok-4.6", openrouterId: "x-ai/grok-4.6", status: "provisional" },
        ],
      }),
    );
    expect(provisionalAliases(file).map((e) => e.aaModelSlug)).toEqual(["grok-4.6"]);
  });
});
