/**
 * Normalization pipeline for raw Artificial Analysis model objects extracted
 * from Flight payloads: incomplete records are discarded, duplicates are
 * deduped deterministically, and the token-count invariant is enforced via
 * the shared schemas. Upstream numeric values are never rounded or recomputed.
 */
import {
  aaModelIdentityKey,
  artificialAnalysisModelSchema,
  type ArtificialAnalysisModel,
} from "../../schemas";
import type { RawAaModel } from "./flight";

/** Fields required for a complete canonical record, in output key order. */
const REQUIRED_TOP_LEVEL = [
  "id",
  "slug",
  "name",
  "shortName",
  "releaseDate",
  "price1mInputTokens",
  "price1mOutputTokens",
  "cacheHitPrice",
  "cacheWritePrice",
  "intelligenceIndex",
  "intelligenceIndexCost",
  "canonicalIntelligenceIndexTokenCount",
] as const;

const INTELLIGENCE_INDEX_COST_FIELDS = ["total"] as const;
const TOKEN_COUNT_FIELDS = ["input", "output", "answer", "reasoning"] as const;

/**
 * Copy a complete raw model into a canonical record with fixed key order so
 * serialization is deterministic regardless of upstream key order. Values are
 * passed through by reference/exactly — no rounding, defaults, or recomputation.
 * Returns null when the record is incomplete (missing/null required field).
 */
export function normalizeModel(raw: RawAaModel): ArtificialAnalysisModel | null {
  const record: Record<string, unknown> = {};
  for (const field of REQUIRED_TOP_LEVEL) {
    const value = raw[field];
    if (value === undefined || value === null) return null;
    record[field] = value;
  }
  const cost = {
    ...(raw["intelligenceIndexCost"] as Record<string, unknown>),
  };
  for (const field of INTELLIGENCE_INDEX_COST_FIELDS) {
    if (cost[field] === undefined || cost[field] === null || typeof cost[field] !== "number") {
      return null;
    }
  }
  record["intelligenceIndexCost"] = { total: cost["total"] };
  const counts = {
    ...(raw["canonicalIntelligenceIndexTokenCount"] as Record<string, unknown>),
  };
  for (const field of TOKEN_COUNT_FIELDS) {
    if (counts[field] === undefined || counts[field] === null || typeof counts[field] !== "number") {
      return null;
    }
  }
  record["canonicalIntelligenceIndexTokenCount"] = {
    input: counts["input"],
    output: counts["output"],
    answer: counts["answer"],
    reasoning: counts["reasoning"],
  };
  return record as unknown as ArtificialAnalysisModel;
}

export interface AaCollectionResult {
  /** Complete, deduped, schema-valid records sorted by identity key. */
  records: ArtificialAnalysisModel[];
  /** Number of raw model objects found before normalization. */
  rawCount: number;
  /** Raw objects discarded because required fields were missing/null. */
  incompleteCount: number;
  /** Raw objects dropped as duplicate identity keys (first occurrence kept). */
  duplicateCount: number;
}

/**
 * Full pipeline from raw Flight model objects to a validated canonical
 * collection. Fails closed: a record that is complete but fails schema
 * validation (e.g. output !== answer + reasoning, non-numeric pricing)
 * aborts the whole collection rather than being silently dropped — that
 * shape indicates upstream corruption or a format change.
 */
export function buildAaCollection(rawModels: RawAaModel[]): AaCollectionResult {
  const byKey = new Map<string, ArtificialAnalysisModel>();
  let incompleteCount = 0;
  let duplicateCount = 0;

  for (const raw of rawModels) {
    const normalized = normalizeModel(raw);
    if (!normalized) {
      incompleteCount += 1;
      continue;
    }
    const parsed = artificialAnalysisModelSchema.safeParse(normalized);
    if (!parsed.success) {
      throw new Error(
        `Complete-looking Artificial Analysis model failed validation ` +
          `(slug: ${String(raw["slug"])}): ${parsed.error.message}`,
      );
    }
    const key = aaModelIdentityKey(parsed.data);
    if (byKey.has(key)) {
      duplicateCount += 1;
      continue; // Deterministic: first occurrence in flight order wins.
    }
    byKey.set(key, parsed.data);
  }

  if (byKey.size === 0) {
    throw new Error(
      "No complete Artificial Analysis models with canonical Intelligence Index " +
        "token counts were found; refusing to emit an empty dataset. The page/RSC " +
        "shape may have changed.",
    );
  }

  const records = [...byKey.values()].sort((a, b) => aaModelIdentityKey(a).localeCompare(aaModelIdentityKey(b)));
  return { records, rawCount: rawModels.length, incompleteCount, duplicateCount };
}
