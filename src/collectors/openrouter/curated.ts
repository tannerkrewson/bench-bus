import { z } from "zod";
import { nonEmptyString } from "../../schemas/primitives";

/** Explicit operator-owned model that must be looked up even off the frontier. */
export const curatedModelSchema = z.object({
  aaModelSlug: nonEmptyString,
  aaModelId: nonEmptyString,
  openrouterId: nonEmptyString.regex(/^[^~][^:]*\/[^:]+$/),
  note: z.string().optional(),
}).strict();
export type CuratedModel = z.infer<typeof curatedModelSchema>;

export const curatedModelConfigSchema = z.object({
  version: z.number().int().positive(),
  description: z.string().optional(),
  models: z.array(curatedModelSchema),
}).strict();
export type CuratedModelConfig = z.infer<typeof curatedModelConfigSchema>;

/** Parse the explicit curated config; malformed operator config fails closed. */
export function parseCuratedModelConfig(raw: string, source = "curated model config"): CuratedModelConfig {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Cannot parse ${source}: ${String(error)}`);
  }
  const parsed = curatedModelConfigSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid ${source}: ${parsed.error.message}`);
  const slugs = parsed.data.models.map((model) => model.aaModelSlug);
  const ids = parsed.data.models.map((model) => model.openrouterId);
  if (new Set(slugs).size !== slugs.length || new Set(ids).size !== ids.length) {
    throw new Error(`Invalid ${source}: duplicate model identity`);
  }
  return parsed.data;
}

/** First forced example; identity is kept separate from automatic frontier selection. */
export const DEFAULT_CURATED_MODELS: readonly CuratedModel[] = [
  {
    aaModelSlug: "deepseek-v4-flash",
    aaModelId: "fe4c0848-e284-4e52-a79d-cdc28392f1a9",
    openrouterId: "deepseek/deepseek-v4-flash-0731",
    note: "DeepSeek V4 0731 Flash; forced into lookup/default visibility when AA and OpenRouter list it.",
  },
];
