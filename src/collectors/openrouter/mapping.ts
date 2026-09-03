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
 * extend the mapping except for a uniquely identified AA frontier model:
 * ambiguous or missing matches are surfaced for human curation instead.
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
    /** Optional stable OpenRouter id whose listed prices are the undiscounted comparison. */
    undiscountedOpenrouterId: nonEmptyString.regex(/^[^~][^:]*\/[^:]+$/, {
      message:
        "undiscountedOpenrouterId must be a bare vendor/model id without ':variant' suffixes or '~' alias prefixes",
    }).optional(),
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
 * Suggest AA -> OpenRouter links by matching the AA slug to an OpenRouter id
 * basename. Exact matches win; otherwise punctuation-normalized names (for
 * example, `model-5-1` and `model-5.1`) and known reasoning-effort suffixes
 * (for example, `model-5-1-high` -> `model-5-1`) are eligible. Output is advisory only:
 * - `obvious`: exactly one catalog id matches; a human may add it to the alias file.
 * - `ambiguous`: multiple candidates; always requires human curation.
 * - `unmatched`: no candidate found.
 * Nothing here mutates the alias file or feeds the collector directly.
 */
const REASONING_EFFORT_SUFFIX = /-(?:extra-high|xhigh|low|medium|high|max)$/i;
const CONTRIBUTOR_SUFFIX = /-contributor$/i;

function normalizedBasename(value: string): string {
  return value.toLocaleLowerCase().replace(/[._]/g, "-").replace(/-+/g, "-");
}

function basenameMatchKeys(value: string): string[] {
  const full = normalizedBasename(value);
  const base = full.replace(REASONING_EFFORT_SUFFIX, "");
  return base === full ? [full] : [full, base];
}

function catalogBasename(modelId: string): string {
  return modelId.includes("/") ? modelId.split("/")[1]! : modelId;
}

function catalogNamespace(modelId: string): string {
  return modelId.includes("/") ? modelId.split("/")[0]!.toLocaleLowerCase() : "";
}

/**
 * Prefer OpenRouter's contributor tier for an automatically admitted frontier
 * model when its ordinary base identity is also present and the pair is
 * unique. The base identity supplies the undiscounted comparison prices.
 */
function contributorPairFor(
  baseModel: CatalogModel,
  catalog: readonly CatalogModel[],
): { contributor: CatalogModel; undiscounted: CatalogModel } | undefined {
  const baseKey = normalizedBasename(catalogBasename(baseModel.id));
  const baseNamespace = catalogNamespace(baseModel.id);
  if (
    CONTRIBUTOR_SUFFIX.test(baseKey) ||
    baseModel.listedInputPrice === undefined ||
    baseModel.listedOutputPrice === undefined
  ) return undefined;
  const contributors = catalog.filter((model) => {
    if (model.id.startsWith("~") || model.id.includes(":")) return false;
    const key = normalizedBasename(catalogBasename(model.id));
    return catalogNamespace(model.id) === baseNamespace &&
      CONTRIBUTOR_SUFFIX.test(key) &&
      key.replace(CONTRIBUTOR_SUFFIX, "") === baseKey;
  });
  return contributors.length === 1
    ? { contributor: contributors[0]!, undiscounted: baseModel }
    : undefined;
}

export function suggestAliases(
  aaModelSlugs: string[],
  catalog: CatalogModel[],
): {
  obvious: ObviousSuggestion[];
  ambiguous: AmbiguousSuggestion[];
  unmatched: string[];
} {
  const byBasename = new Map<string, string[]>();
  const byNormalizedBasename = new Map<string, string[]>();
  for (const model of catalog) {
    if (model.id.startsWith("~") || model.id.includes(":")) continue;
    const base = model.id.includes("/") ? model.id.split("/")[1]! : model.id;
    const list = byBasename.get(base) ?? [];
    list.push(model.id);
    byBasename.set(base, list);
    const normalized = normalizedBasename(base);
    const normalizedList = byNormalizedBasename.get(normalized) ?? [];
    normalizedList.push(model.id);
    byNormalizedBasename.set(normalized, normalizedList);
  }

  const obvious: ObviousSuggestion[] = [];
  const ambiguous: AmbiguousSuggestion[] = [];
  const unmatched: string[] = [];
  for (const slug of aaModelSlugs) {
    let candidates = byBasename.get(slug) ?? [];
    if (candidates.length === 0) {
      for (const key of basenameMatchKeys(slug)) {
        const matches = byNormalizedBasename.get(key);
        if (matches !== undefined && matches.length > 0) {
          candidates = matches;
          break;
        }
      }
    }
    const uniqueCandidates = [...new Set(candidates)].sort();
    if (uniqueCandidates.length === 1) {
      obvious.push({ aaModelSlug: slug, openrouterId: uniqueCandidates[0]! });
    } else if (uniqueCandidates.length > 1) {
      ambiguous.push({ aaModelSlug: slug, candidates: uniqueCandidates });
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
 * guessing: only one exact or normalized basename candidate is accepted.
 * These entries are provisional because the identity was selected by the
 * pipeline, not a human.
 */
export function frontierAliases(
  frontier: readonly AaFrontierIdentity[],
  catalog: readonly CatalogModel[],
): { entries: AliasEntry[]; unmatched: string[]; ambiguous: { aaModelSlug: string; candidates: string[] }[] } {
  const suggestions = suggestAliases(frontier.map((model) => model.slug), [...catalog]);
  const bySlug = new Map(frontier.map((model) => [model.slug, model]));
  const entries = suggestions.obvious.map((match) => {
    const identity = bySlug.get(match.aaModelSlug)!;
    const baseModel = catalog.find((model) => model.id === match.openrouterId);
    const contributorPair = baseModel === undefined ? undefined : contributorPairFor(baseModel, catalog);
    const openrouterId = contributorPair?.contributor.id ?? match.openrouterId;
    return {
      aaModelSlug: identity.slug,
      aaModelId: identity.id,
      openrouterId,
      ...(contributorPair
        ? { undiscountedOpenrouterId: contributorPair.undiscounted.id }
        : {}),
      status: "provisional" as const,
      note: contributorPair
        ? "Automatically included because this AA-listed model is on the deterministic frontier; its unique OpenRouter contributor tier is compared with the base model."
        : "Automatically included because this AA-listed model is on the deterministic frontier.",
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
