/**
 * Verified against https://cursor.com/docs/models-and-pricing#cursor-token-rate
 * on 2026-10-29. Being third-party is NOT the same as owing the Token Rate:
 * Cursor publishes an explicit excluded-model list. Keep release identities
 * exact; an exemption for Haiku 5.5 says nothing about a future Haiku release.
 * Browser-safe and shared by collection and chart pricing.
 */
export const CURSOR_PRICING_SOURCE = "https://cursor.com/docs/models-and-pricing#cursor-token-rate";
export const CURSOR_PRICING_VERIFIED_AT = "2026-10-29";

/** Canonical release identity with only a published reasoning-effort suffix removed. */
export function cursorModelReleaseId(modelId: string): string {
  return modelId.toLowerCase().replace(/[.\s_]+/g, "-")
    .replace(/^claude-/, "")
    .replace(/-(?:extra-high|xhigh|low|medium|high|max|minimal)$/, "");
}

export function isCursorFirstPartyModel(modelId: string): boolean {
  const release = cursorModelReleaseId(modelId);
  return /^composer(?:-|$)/.test(release) || /^grok-4-(?:5|6|7)(?:-|$)/.test(release);
}

const TOKEN_RATE_EXCLUDED_RELEASES = new Set([
  "haiku-5-5",
  "gemini-2-5-flash", "gemini-3-flash", "gemini-3-1-flash-lite", "gemini-3-5-flash-lite",
  "gemini-3-7-flash", "gemini-3-8-flash", "glm-5-3-flash",
  "gpt-4-1-nano", "gpt-4o-mini", "gpt-5-mini", "gpt-5-1-codex-mini",
  "gpt-5-4-mini", "gpt-5-4-nano", "gpt-5-6-luna",
]);

export function cursorTokenRateExemption(modelId: string): "cursor-model" | "excluded-model" | null {
  if (isCursorFirstPartyModel(modelId)) return "cursor-model";
  return TOKEN_RATE_EXCLUDED_RELEASES.has(cursorModelReleaseId(modelId)) ? "excluded-model" : null;
}
