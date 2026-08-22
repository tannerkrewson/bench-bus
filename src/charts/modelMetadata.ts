import type { ModelBrand } from "./types";

/** Shared display/group identity used by both benchmark charts. */
export interface ModelDisplayMetadata {
  /** Concise label shown next to dots, in selectors, and in tooltips. */
  label: string;
  /** Stable family identity shared by all effort variants of a model. */
  groupKey: string;
  /** Normalized effort suffix, when the source publishes one. */
  effort?: string;
  /** Provider family is retained for callers that need it outside the chart. */
  brand?: ModelBrand;
}

const EFFORT_PATTERN = /^(.*?)(?:\s*\((?:adaptive\s+reasoning\s*,\s*)?(extra\s+high|low|medium|high|max)\s+effort?\)|\s+\(?(extra\s+high|low|medium|high|max)\)?)\s*$/i;
const EFFORT_ORDER = ["low", "medium", "high", "extra high", "max"] as const;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Remove vendor prefixes that make the same family needlessly long. */
function removeVendorPrefix(value: string): string {
  return value
    .replace(/^claude\s+/i, "")
    .replace(/^gpt[-\s]*5(?:\.\d+)?\s+/i, "")
    .trim();
}

function normalizeDisplayName(value: string): string {
  let normalized = normalizeWhitespace(value);
  // Artificial Analysis uses V4/V5 while the concise product labels use v4/v5.
  normalized = normalized.replace(/\bV(\d+(?:\.\d+)?)\b/g, "v$1");
  return removeVendorPrefix(normalized);
}

/** Stable URL-safe family key, independent of effort and source benchmark. */
export function modelGroupKey(label: string, id?: string): string {
  const source = normalizeDisplayName(label) || id || "unknown-model";
  return source
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown-model";
}

/**
 * Normalize source model names to one concise identity shared across graphs.
 * Examples:
 *   Claude Opus 5 (Adaptive Reasoning, High Effort) -> Opus 5 High
 *   DeepSeek V4 Flash 0731 (max) -> DeepSeek v4 Flash 0731 Max
 *   GPT-5.6 Luna (low) -> Luna Low
 */
export function modelDisplayMetadata(label: string, id?: string): ModelDisplayMetadata {
  const normalized = normalizeWhitespace(label);
  const match = normalized.match(EFFORT_PATTERN);
  const rawBase = match?.[1] ?? normalized;
  const rawEffort = match?.[2] ?? match?.[3];
  const effort = rawEffort?.toLocaleLowerCase();
  const base = normalizeDisplayName(rawBase);
  const display = normalizeWhitespace(effort ? `${base} ${formatEffort(effort)}` : base);
  return {
    label: display,
    groupKey: modelGroupKey(base, id),
    ...(effort ? { effort } : {}),
  };
}

export function formatEffort(effort: string): string {
  const normalized = effort.toLocaleLowerCase();
  return EFFORT_ORDER.includes(normalized as (typeof EFFORT_ORDER)[number])
    ? normalized.replace(/\b\w/g, (character) => character.toUpperCase())
    : effort;
}

/** Return an explicit numeric order for stable variant rendering. */
export function modelEffortOrder(effort?: string): number {
  const index = EFFORT_ORDER.indexOf(effort?.toLocaleLowerCase() as (typeof EFFORT_ORDER)[number]);
  return index < 0 ? 99 : index;
}
