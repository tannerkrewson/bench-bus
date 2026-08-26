import type { RawAaModel } from "../flight";

/** Live AA record used to regress source-null cache-write normalization. */
export const realGlm53FlashRawModel: RawAaModel = {
  id: "19496b81-9f41-4214-a77a-1df803b3c5ae",
  slug: "glm-5-3-flash",
  name: "GLM-5.3-Flash",
  shortName: "GLM-5.3-Flash",
  releaseDate: "2026-08-26",
  price1mInputTokens: 0.15,
  price1mOutputTokens: 0.5,
  cacheHitPrice: 0.026,
  cacheWritePrice: null,
  intelligenceIndex: 57.4592004791323,
  intelligenceIndexCost: { total: 138.0208940822332 },
  canonicalIntelligenceIndexTokenCount: {
    input: 2083518446,
    output: 148780822,
    answer: 14330281,
    reasoning: 134450541,
  },
};
