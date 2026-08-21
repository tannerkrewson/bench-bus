import { CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS } from "../../schemas";

/**
 * Cursor's flat third-party-model surcharge, USD per million processed tokens.
 * Raw collection never applies this value: CursorBench `tokensPerTask` is
 * completion/output tokens, not total processed tokens. Chart pricing combines
 * it with published cost, output pricing, and valid non-output rates.
 */
export const CURSOR_THIRD_PARTY_SURCHARGE_USD_PER_MILLION_TOKENS: number =
  CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS;

/**
 * Generic surcharge arithmetic for an already-estimated total token volume.
 * Callers must not pass CursorBench completion tokens here as a total volume.
 */
export function computeThirdPartySurchargeUsd(
  estimatedTotalProcessedTokens: number,
  usdPerMillionTokens: number = CURSOR_THIRD_PARTY_SURCHARGE_USD_PER_MILLION_TOKENS,
): number {
  if (!Number.isFinite(estimatedTotalProcessedTokens) || estimatedTotalProcessedTokens < 0) {
    throw new TypeError(
      `estimatedTotalProcessedTokens must be a finite non-negative number, got ${estimatedTotalProcessedTokens}`,
    );
  }
  if (!Number.isFinite(usdPerMillionTokens) || usdPerMillionTokens < 0) {
    throw new TypeError(
      `usdPerMillionTokens must be a finite non-negative number, got ${usdPerMillionTokens}`,
    );
  }
  return (estimatedTotalProcessedTokens / 1_000_000) * usdPerMillionTokens;
}
