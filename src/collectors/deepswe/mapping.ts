import { z } from "zod";
import { nonEmptyString } from "../../schemas/primitives";
import type { DeepSweScoreRecord } from "../../schemas/deepswe";
import aliasSeed from "./deepswe-model-aliases.json";

/** Explicit score-source to AA identity mapping; no fuzzy model matching is used. */
export const deepSweAliasEntrySchema = z
  .object({
    aaModelSlug: nonEmptyString,
    deepSweModel: nonEmptyString,
    harness: nonEmptyString,
    reasoningEffort: nonEmptyString.nullable(),
    note: z.string().optional(),
  })
  .strict();

export type DeepSweAliasEntry = z.infer<typeof deepSweAliasEntrySchema>;

export const deepSweAliasFileSchema = z
  .object({
    version: z.number().int().positive(),
    description: z.string().optional(),
    entries: z.array(deepSweAliasEntrySchema).min(1),
  })
  .strict()
  .refine(
    (file) => new Set(file.entries.map((entry) => entry.aaModelSlug)).size === file.entries.length,
    { message: "duplicate aaModelSlug in DeepSWE alias file" },
  );

export function parseDeepSweAliasFile(raw: string, source = "DeepSWE alias file") {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Cannot parse ${source}: ${String(error)}`);
  }
  const parsed = deepSweAliasFileSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid ${source}: ${parsed.error.message}`);
  return parsed.data;
}

export const DEFAULT_DEEPSWE_ALIASES: readonly DeepSweAliasEntry[] =
  deepSweAliasFileSchema.parse(aliasSeed).entries;

export function deepSweScoreIdentity(record: Pick<DeepSweScoreRecord, "model" | "harness" | "reasoningEffort">): string {
  return `${record.model}\u0000${record.harness}\u0000${record.reasoningEffort ?? ""}`;
}

export function deepSweAliasIdentity(entry: DeepSweAliasEntry): string {
  return `${entry.deepSweModel}\u0000${entry.harness}\u0000${entry.reasoningEffort ?? ""}`;
}
