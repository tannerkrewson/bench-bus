import {
  cursorSnapshotPayloadSchema,
  validateCursorEvalCollection,
  type CursorEvalRecord,
  type CursorSnapshotPayload,
} from "../../schemas";
import type { RawCursorEvalRow } from "./types";

/**
 * Normalization: raw scraped rows -> validated canonical Cursor eval records
 * (shared schema from src/schemas — never duplicated here).
 */

/**
 * Cursor first-party model name patterns. Any row NOT matching one of these is
 * classified as third-party (served via another vendor's API) and is therefore
 * subject to the optional $0.25/M-token Cursor surcharge computed downstream.
 *
 * This is a maintained heuristic, not scraped data: the evals page does not
 * publish a first-party/third-party column. Extend this list if Cursor ships
 * new first-party models; err toward adding explicit patterns rather than
 * loosening the third-party default.
 */
const FIRST_PARTY_MODEL_PATTERNS: RegExp[] = [/^composer/i];

/**
 * Serving provider derived from the model family prefix. The evals table does
 * not publish a provider column; this maintained mapping exists because the
 * canonical record schema requires a provider identity. Unknown families map
 * to "unknown" rather than guessing.
 */
const PROVIDER_BY_MODEL_PREFIX: ReadonlyArray<readonly [RegExp, string]> = [
  [/^grok/i, "xai"],
  [/^gpt/i, "openai"],
  [/^(opus|sonnet)/i, "anthropic"],
  [/^gemini/i, "google"],
  [/^kimi/i, "moonshot"],
  [/^glm/i, "zai"],
  [/^composer/i, "cursor"],
];

/** Deterministic identity key for a published model name, e.g. "Opus 5 Max" -> "opus-5-max". */
export function cursorModelId(modelName: string): string {
  return modelName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function deriveProvider(modelName: string): string {
  for (const [pattern, provider] of PROVIDER_BY_MODEL_PREFIX) {
    if (pattern.test(modelName)) {
      return provider;
    }
  }
  return "unknown";
}

export function deriveIsThirdParty(modelName: string): boolean {
  return !FIRST_PARTY_MODEL_PATTERNS.some((pattern) => pattern.test(modelName));
}

/**
 * Map one raw scraped row onto the canonical record schema.
 *
 * The table publishes aggregate per-task figures only (one cost, one token
 * count), so per the schema contract the aggregate cost is recorded in
 * `publishedCostUsd`, input/output token counts are left undefined, and the
 * aggregate tokens/steps are preserved verbatim in `tokensPerTask`/
 * `stepsPerTask` (never invented into input/output splits). The optional
 * $0.25/M surcharge is applied downstream (surcharge.ts), never baked in here.
 */
export function toCanonicalRecord(row: RawCursorEvalRow): CursorEvalRecord {
  return {
    modelId: cursorModelId(row.modelName),
    modelName: row.modelName,
    provider: deriveProvider(row.modelName),
    isThirdParty: deriveIsThirdParty(row.modelName),
    score: row.scorePercent,
    publishedCostUsd: row.costPerTaskUsd,
    tokensPerTask: row.tokensPerTask,
    stepsPerTask: row.stepsPerTask,
  };
}

/** Normalize and validate a full table parse into deterministic canonical records. */
export function toCanonicalRecords(rows: RawCursorEvalRow[]): CursorEvalRecord[] {
  // validateCursorEvalCollection rejects duplicates and sorts by modelId, so
  // the output is byte-stable for identical upstream data.
  return validateCursorEvalCollection(rows.map(toCanonicalRecord));
}

/** Build the validated collector output payload (observedAt + source + records). */
export function buildSnapshotPayload(
  rows: RawCursorEvalRow[],
  observedAt: string,
): CursorSnapshotPayload {
  const payload = {
    observedAt,
    source: { source: "cursor" as const, pageUrl: "https://cursor.com/evals" as const },
    records: toCanonicalRecords(rows),
  };
  const result = cursorSnapshotPayloadSchema.safeParse(payload);
  if (!result.success) {
    throw new Error(`Internal error: collector output failed schema validation: ${result.error.message}`);
  }
  return result.data;
}
