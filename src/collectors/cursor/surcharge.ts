import type { CursorEvalRecord } from "../../schemas";

/**
 * Optional Cursor third-party-model surcharge support.
 *
 * Cursor applies a flat surcharge of $0.25 per million tokens to models it
 * serves via a third-party API. The evals page does NOT publish this
 * surcharge, so it is never baked into scraped values: raw
 * `publishedCostUsd` stays as published, and the surcharge is computed
 * separately here so chart code can toggle it on/off.
 */

/** Cursor's flat surcharge for third-party models, USD per million tokens. */
export const CURSOR_THIRD_PARTY_SURCHARGE_USD_PER_MILLION_TOKENS = 0.25;

/** Surcharge for one benchmark task, given the task's token usage. */
export function computeThirdPartySurchargeUsd(
  tokensPerTask: number,
  usdPerMillionTokens: number = CURSOR_THIRD_PARTY_SURCHARGE_USD_PER_MILLION_TOKENS,
): number {
  if (!Number.isFinite(tokensPerTask) || tokensPerTask < 0) {
    throw new TypeError(`tokensPerTask must be a finite non-negative number, got ${tokensPerTask}`);
  }
  if (!Number.isFinite(usdPerMillionTokens) || usdPerMillionTokens < 0) {
    throw new TypeError(
      `usdPerMillionTokens must be a finite non-negative number, got ${usdPerMillionTokens}`,
    );
  }
  return (tokensPerTask / 1_000_000) * usdPerMillionTokens;
}

export interface CursorSurchargeResult {
  modelId: string;
  isThirdParty: boolean;
  /**
   * Surcharge in USD for one task; 0 for first-party models. Derived value —
   * never written back into raw or canonical records.
   */
  surchargeUsd: number;
  /** Published cost plus surcharge, when the row is third-party; otherwise the published cost. */
  costWithSurchargeUsd: number;
}

/**
 * Compute the per-task surcharge for each record. Token counts are NOT part
 * of the canonical record (the table publishes only aggregate tokens/task, in
 * the raw rows), so callers supply them from the same scrape keyed by modelId.
 * Records without a supplied token count get no surcharge rather than a guess.
 */
export function computeCursorSurcharges(
  records: readonly CursorEvalRecord[],
  tokensPerTaskByModelId: ReadonlyMap<string, number>,
): CursorSurchargeResult[] {
  return records.map((record) => {
    const tokens = tokensPerTaskByModelId.get(record.modelId);
    const surchargeUsd =
      record.isThirdParty && tokens !== undefined
        ? computeThirdPartySurchargeUsd(tokens)
        : 0;
    return {
      modelId: record.modelId,
      isThirdParty: record.isThirdParty,
      surchargeUsd,
      costWithSurchargeUsd: (record.publishedCostUsd ?? 0) + surchargeUsd,
    };
  });
}
