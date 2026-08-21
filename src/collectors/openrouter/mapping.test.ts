import { describe, expect, it } from "vitest";
import {
  AliasFileError,
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

  it("rejects two AA models mapped to the same OpenRouter id", () => {
    expect(() =>
      parseAliasFile(
        JSON.stringify({
          version: 1,
          entries: [VALID_ENTRY, { ...VALID_ENTRY, aaModelSlug: "claude-opus-5-fast" }],
        }),
      ),
    ).toThrow(/duplicate/);
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
