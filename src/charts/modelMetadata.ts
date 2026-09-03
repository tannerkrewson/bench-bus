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
// spellings and Cursor's concise bare suffix.
const EFFORT_PATTERN = /^(.*?)(?:\s*\(\s*(?:(?:adaptive\s+)?reasoning\s*,\s*)?(extra\s+high|xhigh|low|medium|high|max)(?:\s+effort)?(?:\s*,[^)]*)*\s*\)|\s+(extra\s+high|xhigh|low|medium|high|max)(?:\s+effort)?)\s*$/i;
const NON_REASONING_PATTERN = /\bnon[\s-]*reasoning\b/i;

/** Source feeds may publish a non-reasoning base beside reasoning variants. */
export function isNonReasoningModel(label: string, id?: string): boolean {
  return NON_REASONING_PATTERN.test(label) || NON_REASONING_PATTERN.test(id ?? "");
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Remove vendor prefixes that make the same family needlessly long. */
function removeVendorPrefix(value: string): string {
  return value.replace(/^claude\s+/i, "").trim();
}

function normalizeDisplayName(value: string): string {
  // Parenthesized source annotations are metadata, not part of the model
  // identity. Effort annotations are parsed before this cleanup; removing any
  // remaining annotation keeps labels safe for selectors and tooltips too.
  let normalized = normalizeWhitespace(value).replace(/\s*\([^)]*\)/g, "");
  // Artificial Analysis uses V4/V5 while the concise product labels use v4/v5.
  normalized = normalized.replace(/\bV(\d+(?:\.\d+)?)\b/g, "v$1");
  // Keep GPT in the canonical identity. A few source rows spell it as a
  // detached prefix (or omit it from the codename), so normalize both forms.
  normalized = normalized.replace(/^gpt[\s-]*(\d+(?:\.\d+)?)/i, "GPT-$1");
  normalized = normalized.replace(/^(\d+(?:\.\d+)?)\s+(?=(?:luna|sol)\b)/i, "GPT-$1 ");
  return removeVendorPrefix(normalized);
}

/**
 * AA and OpenRouter use different April release markers for the legacy V4
 * models. Keep the product-facing marker consistent while leaving the later
 * 0731 and 0813 releases untouched.
 */
function normalizeDeepSeekRelease(value: string, id?: string): string {
  const haystack = `${value} ${id ?? ""}`;
  const isDeepSeekV4 =
    /\bdeepseek\b.*\bv4\b.*\b(?:flash|pro)\b/i.test(value) ||
    /(?:^|\/)deepseek-v4-(?:flash|pro)(?:-|$)/i.test(id ?? "");
  if (!isDeepSeekV4) return value;
  if (/\b(?:0423|0731|0813)\b/i.test(haystack) || /(?:^|\/)deepseek-v4-(?:flash|pro)$/i.test(id ?? "")) {
    return value;
  }
  return `${value.replace(/\s+\b(?:0420|0424)\b/gi, "").trim()} 0423`;
}

function splitModelName(label: string): { base: string; effort?: ModelEffort } {
  const normalized = normalizeWhitespace(label);
  const withoutNonReasoning = normalized.replace(NON_REASONING_PATTERN, "");
  const match = withoutNonReasoning.match(EFFORT_PATTERN);
  const rawEffort = match?.[2] ?? match?.[3];
  const effort = rawEffort?.toLocaleLowerCase().replace("extra high", "xhigh") as ModelEffort | undefined;
  return {
    base: normalizeDisplayName(match?.[1] ?? withoutNonReasoning),
    ...(effort && EFFORT_NAMES.includes(effort) ? { effort } : {}),
  };
}

function effortFromId(id: string | undefined): ModelEffort | undefined {
  const raw = id?.match(/(?:^|-)(extra-high|xhigh|low|medium|high|max)$/i)?.[1];
  if (!raw) return undefined;
  const effort = raw.toLocaleLowerCase().replace("extra-high", "xhigh") as ModelEffort;
  return EFFORT_NAMES.includes(effort) ? effort : undefined;
}

function versionFromModelId(id: string | undefined): readonly number[] | null {
  const base = id?.split("/").pop()?.replace(/-(?:extra-high|xhigh|low|medium|high|max)$/i, "")
    .replace(/-non-reasoning$/i, "");
  if (!base) return null;
  const version: number[] = [];
  let started = false;
  for (const part of base.split("-")) {
    const match = part.match(/^v?(\d+(?:\.\d+)?)$/i);
    if (!match) {
      if (started) break;
      continue;
    }
    // Four-digit segments are release dates, not product versions.
    if (match[1]!.length === 4) continue;
    started = true;
    version.push(...match[1]!.split(".").map(Number));
  }
  return version.length > 0 && version.every(Number.isFinite) ? version : null;
}

/** Stable URL-safe family key, independent of effort and source benchmark. */
export function modelGroupKey(label: string, id?: string): string {
  const parsed = splitModelName(label);
  const source = normalizeDeepSeekRelease(parsed.base, id) || normalizeDisplayName(id ?? "") || "unknown-model";
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
  const base = normalizeDeepSeekRelease(parsed.base, id);
  const display = normalizeWhitespace(effort ? `${base} ${effort}` : base);
  return {
    label: display,
    groupKey: modelGroupKey(base, id),
    ...(effort ? { effort } : {}),
  };
}

export interface ModelVersionIdentity {
  /** Family key with the first numeric release removed, e.g. `glm`. */
  familyKey: string;
  /** Numeric release components, compared left-to-right. */
  version: readonly number[];
}

/**
 * Extract the product family and release from a source label. This deliberately
 * ignores four-digit release markers such as DeepSeek's 0423 after using the
 * first product version, so only actual newer product releases supersede one
 * another in the default view.
 */
export function modelVersionIdentity(label: string, id?: string): ModelVersionIdentity | null {
  const base = splitModelName(label).base;
  const match = /(?<!\d)(?:v)?(\d+(?:\.\d+)+|\d+)(?!\d)/i.exec(base);
  const fallbackVersion = match ? null : versionFromModelId(id);
  if (!match && fallbackVersion === null) return null;
  const version = match ? match[1]!.split(".").map(Number) : fallbackVersion!;
  if (version.length === 0 || version.some((part) => !Number.isFinite(part))) return null;
  const familyKey = normalizeWhitespace(
    match && match.index !== undefined
      ? `${base.slice(0, match.index)} ${base.slice(match.index + match[0].length)}`
      : base,
  )
    .replace(/\b\d{4}\b/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!familyKey) {
    // A bare numeric label is not enough evidence to infer a family. The id is
    // only a fallback for source rows whose display label omitted its version.
    const idBase = id?.split("/").pop()?.replace(/-(?:low|medium|high|xhigh|max)$/i, "");
    if (!idBase) return null;
    return modelVersionIdentity(idBase.replace(/-/g, " "), undefined);
  }
  return { familyKey, version };
}

function compareModelVersions(first: readonly number[], second: readonly number[]): number {
  const length = Math.max(first.length, second.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (first[index] ?? 0) - (second[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Remove superseded releases from an implicit/default model selection. */
export function latestModelVersionIds<T extends { id: string; label: string }>(
  models: readonly T[],
  candidateIds: readonly string[],
): string[] {
  const latestByFamily = new Map<string, readonly number[]>();
  for (const model of models) {
    const identity = modelVersionIdentity(model.label, model.id);
    if (!identity) continue;
    const latest = latestByFamily.get(identity.familyKey);
    if (!latest || compareModelVersions(identity.version, latest) > 0) {
      latestByFamily.set(identity.familyKey, identity.version);
    }
  }

  return [...new Set(candidateIds)].filter((id) => {
    const model = models.find((candidate) => candidate.id === id);
    if (!model) return true;
    const identity = modelVersionIdentity(model.label, model.id);
    const latest = identity ? latestByFamily.get(identity.familyKey) : undefined;
    return !identity || !latest || compareModelVersions(identity.version, latest) === 0;
  });
}

/**
 * Use a provider-qualified canonical name in detail views while keeping chart
 * labels concise. Effort and source-only parenthetical annotations are omitted.
 */
export function expandedModelName(label: string, id?: string): string {
  const base = splitModelName(label).base || normalizeDisplayName(label);
  const haystack = `${label} ${id ?? ""}`.toLocaleLowerCase();
  if (/(?:claude|anthropic|opus|sonnet|fable)/.test(haystack)) {
    return `Anthropic ${/^claude\b/i.test(base) ? base : `Claude ${base}`}`;
  }
  if (/(?:gpt|openai)/.test(haystack)) return `OpenAI ${base}`;
  if (/(?:gemini|google)/.test(haystack)) return `Google ${base}`;
  if (/(?:glm|z-ai)/.test(haystack)) return `Z.ai ${base}`;
  if (/(?:muse|meta)/.test(haystack)) return `Meta ${base}`;
  if (/(?:kimi|moonshot)/.test(haystack)) return `MoonshotAI ${base}`;
  return base;
}

export function formatEffort(effort: string): string {
  const normalized = normalizeWhitespace(effort)
    .toLocaleLowerCase()
    .replace(/\s+effort$/, "")
    .replace("extra high", "xhigh");
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
