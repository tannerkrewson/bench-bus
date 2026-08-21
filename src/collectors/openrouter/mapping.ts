import { z } from "zod";
import { nonEmptyString } from "../../schemas/primitives";
import type { AaFrontierIdentity } from "../aa/frontier";
import type { CuratedModel } from "./curated";

/**
 * Explicit, version-controlled mapping from Artificial Analysis model identity
 * to the stable OpenRouter model id.
 *
 * This file is the ONLY sanctioned link between the two catalogs. Automatic
 * matching may SUGGEST entries (see `suggestAliases`) but must never silently
 * extend the mapping: ambiguous or missing matches are surfaced for human
 * curation instead.
 */
export const aliasEntrySchema = z
  .object({
    /** Artificial Analysis slug, e.g. "claude-opus-5". */
    aaModelSlug: nonEmptyString,
    /** Artificial Analysis model id; AA slug as placeholder until curated. */
    aaModelId: nonEmptyString,
    /** Stable OpenRouter model id: no date suffix, no ":variant", no "~alias". */
    openrouterId: nonEmptyString.regex(/^[^~][^:]*\/[^:]+$/, {
      message:
        "openrouterId must be a bare vendor/model id without ':variant' suffixes or '~' alias prefixes",
    }),
    /** confirmed = identity verified against both catalogs. */
    status: z.enum(["confirmed", "provisional"]),
    note: z.string().optional(),
  })
  .strict();

export type AliasEntry = z.infer<typeof aliasEntrySchema>;

export const aliasFileSchema = z
  .object({
    version: z.number().int().positive(),
    description: z.string().optional(),
    entries: z.array(aliasEntrySchema).min(1),
  })
  .refine(
    (file) => {
      const aaSlugs = file.entries.map((e) => e.aaModelSlug);
      return new Set(aaSlugs).size === aaSlugs.length;
    },
    { message: "duplicate aaModelSlug in alias file" },
  );

export type AliasFile = z.infer<typeof aliasFileSchema>;

/** Thrown when the alias file on disk is missing or malformed. */
export class AliasFileError extends Error {}

/** Parse and validate raw alias-file JSON. Fail closed on any problem. */
export function parseAliasFile(raw: string, source = "alias file"): AliasFile {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new AliasFileError(`Cannot parse ${source}: ${String(cause)}`);
  }
  const parsed = aliasFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new AliasFileError(`Invalid ${source}: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Load and validate the alias mapping file. Fail closed on any problem:
 * a broken mapping must never produce a mispriced snapshot.
 */
export function loadAliasFile(path: string, readFile: (p: string) => string): AliasFile {
  let raw: string;
  try {
    raw = readFile(path);
  } catch (cause) {
    throw new AliasFileError(`Cannot read alias file at ${path}: ${String(cause)}`);
  }
  return parseAliasFile(raw, `alias file at ${path}`);
}

export interface CatalogModel {
  id: string;
  canonicalSlug: string;
  name: string;
  /** Listed catalog prices, USD per 1M tokens, when the source publishes them. */
  listedInputPrice?: number;
  listedOutputPrice?: number;
  listedCacheReadPrice?: number;
  listedCacheWritePrice?: number;
}

export interface ObviousSuggestion {
  aaModelSlug: string;
  openrouterId: string;
}

export interface AmbiguousSuggestion {
  aaModelSlug: string;
  candidates: string[];
}

/**
 * Suggest AA -> OpenRouter links by exact basename match between the AA slug
 * and the OpenRouter id. Output is advisory only:
 * - `obvious`: exactly one catalog id matches; a human may add it to the alias file.
 * - `ambiguous`: multiple candidates; always requires human curation.
 * - `unmatched`: no candidate found.
 * Nothing here mutates the alias file or feeds the collector directly.
 */
export function suggestAliases(
  aaModelSlugs: string[],
  catalog: CatalogModel[],
): {
  obvious: ObviousSuggestion[];
  ambiguous: AmbiguousSuggestion[];
  unmatched: string[];
} {
  const byBasename = new Map<string, string[]>();
  for (const model of catalog) {
    if (model.id.startsWith("~") || model.id.includes(":")) continue;
    const base = model.id.includes("/") ? model.id.split("/")[1]! : model.id;
    const list = byBasename.get(base) ?? [];
    list.push(model.id);
    byBasename.set(base, list);
  }

  const obvious: ObviousSuggestion[] = [];
  const ambiguous: AmbiguousSuggestion[] = [];
  const unmatched: string[] = [];
  for (const slug of aaModelSlugs) {
    const candidates = byBasename.get(slug) ?? [];
    if (candidates.length === 1) {
      obvious.push({ aaModelSlug: slug, openrouterId: candidates[0]! });
    } else if (candidates.length > 1) {
      ambiguous.push({ aaModelSlug: slug, candidates: candidates.sort() });
    } else {
      unmatched.push(slug);
    }
  }
  return { obvious, ambiguous, unmatched };
}

/**
 * Aliases whose identity is not fully verified. The collector includes
 * provisional entries (so a curated mapping is not silently ignored) but
 * every run report must surface them.
 */
export function provisionalAliases(file: AliasFile): AliasEntry[] {
  return file.entries.filter((e) => e.status === "provisional");
}

/**
 * Resolve automatic AA frontier identities against the catalog without
 * guessing: only one exact basename candidate is accepted. These entries are
 * provisional because the identity was selected by the pipeline, not a human.
 */
export function frontierAliases(
  frontier: readonly AaFrontierIdentity[],
  catalog: readonly CatalogModel[],
): { entries: AliasEntry[]; unmatched: string[]; ambiguous: { aaModelSlug: string; candidates: string[] }[] } {
  const suggestions = suggestAliases(frontier.map((model) => model.slug), [...catalog]);
  const bySlug = new Map(frontier.map((model) => [model.slug, model]));
  const entries = suggestions.obvious.map((match) => {
    const identity = bySlug.get(match.aaModelSlug)!;
    return {
      aaModelSlug: identity.slug,
      aaModelId: identity.id,
      openrouterId: match.openrouterId,
      status: "provisional" as const,
      note: "Automatically included because this AA-listed model is on the deterministic frontier.",
    };
  });
  return { entries, unmatched: suggestions.unmatched, ambiguous: suggestions.ambiguous };
}

/** Convert explicit forced models to alias entries while preserving provenance. */
export function curatedAliases(models: readonly CuratedModel[]): AliasEntry[] {
  return models.map((model) => ({
    aaModelSlug: model.aaModelSlug,
    aaModelId: model.aaModelId,
    openrouterId: model.openrouterId,
    status: "confirmed" as const,
    ...(model.note ? { note: model.note } : {}),
  }));
}
