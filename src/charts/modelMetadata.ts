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

const EFFORT_NAMES = ["low", "medium", "high", "xhigh", "max"] as const;
const EFFORT_ORDER = [...EFFORT_NAMES] as const;
type ModelEffort = (typeof EFFORT_NAMES)[number];

// Source feeds use all of these forms, including AA's verbose reasoning
// spelling and Cursor's concise bare suffix.
const EFFORT_PATTERN = /^(.*?)(?:\s*\(\s*(?:adaptive\s+reasoning\s*,\s*)?(extra\s+high|xhigh|low|medium|high|max)(?:\s+effort)?\s*\)|\s+(extra\s+high|xhigh|low|medium|high|max)(?:\s+effort)?)\s*$/i;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Remove vendor prefixes that make the same family needlessly long. */
function removeVendorPrefix(value: string): string {
  return value.replace(/^claude\s+/i, "").trim();
}

function normalizeDisplayName(value: string): string {
  let normalized = normalizeWhitespace(value);
  // Artificial Analysis uses V4/V5 while the concise product labels use v4/v5.
  normalized = normalized.replace(/\bV(\d+(?:\.\d+)?)\b/g, "v$1");
  // Keep GPT in the canonical identity. A few source rows spell it as a
  // detached prefix (or omit it from the codename), so normalize both forms.
  normalized = normalized.replace(/^gpt[\s-]*(\d+(?:\.\d+)?)/i, "GPT-$1");
  normalized = normalized.replace(/^(\d+(?:\.\d+)?)\s+(?=(?:luna|sol)\b)/i, "GPT-$1 ");
  return removeVendorPrefix(normalized);
}

function splitModelName(label: string): { base: string; effort?: ModelEffort } {
  const normalized = normalizeWhitespace(label);
  const match = normalized.match(EFFORT_PATTERN);
  const rawEffort = match?.[2] ?? match?.[3];
  const effort = rawEffort?.toLocaleLowerCase().replace("extra high", "xhigh") as ModelEffort | undefined;
  return {
    base: normalizeDisplayName(match?.[1] ?? normalized),
    ...(effort && EFFORT_NAMES.includes(effort) ? { effort } : {}),
  };
}

function effortFromId(id: string | undefined): ModelEffort | undefined {
  const raw = id?.match(/(?:^|-)(extra-high|xhigh|low|medium|high|max)$/i)?.[1];
  if (!raw) return undefined;
  const effort = raw.toLocaleLowerCase().replace("extra-high", "xhigh") as ModelEffort;
  return EFFORT_NAMES.includes(effort) ? effort : undefined;
}

/** Stable URL-safe family key, independent of effort and source benchmark. */
export function modelGroupKey(label: string, id?: string): string {
  const parsed = splitModelName(label);
  const source = parsed.base || normalizeDisplayName(id ?? "") || "unknown-model";
  return source
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown-model";
}

/**
 * Normalize source model names to one concise identity shared across graphs.
 * Effort names are deliberately lower-case and `extra high` is shortened to
 * `xhigh`; no source parentheses leak into chart labels.
 */
export function modelDisplayMetadata(label: string, id?: string): ModelDisplayMetadata {
  const parsed = splitModelName(label);
  const effort = parsed.effort ?? effortFromId(id);
  const display = normalizeWhitespace(effort ? `${parsed.base} ${effort}` : parsed.base);
  return {
    label: display,
    groupKey: modelGroupKey(parsed.base, id),
    ...(effort ? { effort } : {}),
  };
}

export function formatEffort(effort: string): string {
  const normalized = effort.toLocaleLowerCase().replace("extra high", "xhigh");
  return EFFORT_NAMES.includes(normalized as ModelEffort) ? normalized : effort;
}

/** Return an explicit numeric order for stable variant rendering. */
export function modelEffortOrder(effort?: string): number {
  const index = EFFORT_ORDER.indexOf(formatEffort(effort ?? "") as ModelEffort);
  return index < 0 ? 99 : index;
}

/** Choose the family label: high when available, otherwise highest effort. */
export function preferredFamilyLabel(
  members: readonly { label: string; effort?: string }[],
  fallback: string,
): string {
  const withEffort = members.filter((member) => member.effort !== undefined);
  if (withEffort.length === 0) return fallback;
  const high = withEffort.find((member) => formatEffort(member.effort!) === "high");
  if (high) return high.label;
  return [...withEffort].sort(
    (a, b) => modelEffortOrder(b.effort) - modelEffortOrder(a.effort) || a.label.localeCompare(b.label),
  )[0]!.label;
}
