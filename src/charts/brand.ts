import type { ModelBrand } from "./types";

/** Stable provider families used to color points consistently across charts. */
export const MODEL_BRANDS: readonly ModelBrand[] = [
  "anthropic",
  "openai",
  "google",
  "cursor",
  "meta",
  "mistral",
  "deepseek",
  "qwen",
  "xai",
  "other",
];

/** Infer a display family from the model/provider strings available in feeds. */
export function inferModelBrand(...parts: readonly (string | undefined)[]): ModelBrand {
  const haystack = parts.filter(Boolean).join(" ").toLowerCase();
  if (/(claude|anthropic)/.test(haystack)) return "anthropic";
  if (/(gpt|openai|o[1-9](?:[-.]|$)|o[234]-)/.test(haystack)) return "openai";
  if (/(gemini|google|gemma)/.test(haystack)) return "google";
  if (/(cursor|composer)/.test(haystack)) return "cursor";
  if (/(llama|meta|muse)/.test(haystack)) return "meta";
  if (/mistral/.test(haystack)) return "mistral";
  if (/deepseek/.test(haystack)) return "deepseek";
  if (/(qwen|alibaba)/.test(haystack)) return "qwen";
  if (/(grok|xai)/.test(haystack)) return "xai";
  return "other";
}

// This is the sole model-family palette. Every slot is an audited,
// color-blind-safe hue and must remain compliant: do not add a non-compliant
// fallback or theme-specific color outside these arrays.
/**
 * Color-blind family slots are exported so the contrast contract can be tested
 * without depending on a rendered browser canvas. Keep both arrays the same
 * length as WELL_KNOWN_GROUP_SLOTS below.
 *
 * Dark slots are intentionally lighter than canonical Okabe-Ito swatches.
 * Aqua's base-100 surface is the brightest supported dark surface, so every
 * dark slot targets 4.5:1 there (the text-sized contrast threshold).
 */
export const COLOR_BLIND_MODEL_GROUP_PALETTE = {
  light: [
    "#005a9c", // blue
    "#b54708", // orange
    "#007a5e", // green
    "#b3311f", // vermilion
    "#7a4eab", // purple
    "#007c91", // teal
    "#8a6500", // gold
    "#a23b72", // magenta
    "#6c584c", // brown
    "#4f6d2f", // olive
    "#5b3f8c", // violet
    "#006d77", // deep teal
    "#8c2d04", // rust
    "#3d405b", // slate
    "#283618", // forest
    "#5a3d5c", // plum
    "#3c2f80", // indigo
    "#7b2c3f", // burgundy
  ],
  dark: [
    "#56b4e9", // sky blue
    "#e69f00", // orange
    "#40c99a", // green
    "#ff8566", // vermilion
    "#c59bd8", // purple
    "#7cc7e8", // teal
    "#f0e442", // yellow
    "#ed9bc3", // magenta
    "#d0b49f", // brown
    "#a6d854", // olive
    "#c2a0f5", // violet
    "#a8dadc", // aqua
    "#f4a261", // peach
    "#b8c0ff", // periwinkle
    "#d0e17d", // lime
    "#d5b2c4", // mauve
    "#ffd166", // amber
    "#d8b4fe", // lavender
  ],
} as const;

/** WCAG contrast target used for colored model labels and chart marks. */
export const COLOR_BLIND_CONTRAST_TARGET = 4.5;

/**
 * sRGB conversions of representative DaisyUI 5.7.20 base-100 swatches.
 * Aqua, Black, Luxury, and Halloween are the supported dark themes whose
 * base surfaces exercise the hardest dark-theme contrast cases.
 */
export const COLOR_BLIND_SURFACE_SWATCHES = {
  light: [
    { theme: "light", color: "#ffffff" },
    { theme: "caramellatte", color: "#fff7ed" },
  ],
  dark: [
    { theme: "aqua", color: "#1a368b" },
    { theme: "black", color: "#000000" },
    { theme: "luxury", color: "#09090b" },
    { theme: "halloween", color: "#1b1816" },
  ],
} as const;

const WELL_KNOWN_GROUP_SLOTS: Readonly<Record<string, number>> = {
  // Keep both the concise chart-family keys and source-derived GPT keys
  // explicitly assigned. Hash fallbacks can collide, which made Luna and
  // Sol visually indistinguishable in some feeds.
  "opus-5": 0,
  "claude-opus-5": 0,
  "sonnet-5": 8,
  "grok-4-6": 2,
  "grok-4-5": 2,
  luna: 3,
  "gpt-5-6-luna": 3,
  // Keep Sol gold and Gemini violet: both are deliberately far from the
  // DeepSeek blue preset and from each other in perceptual color space.
  sol: 6,
  "gpt-5-6-sol": 6,
  terra: 4,
  "gpt-5-6-terra": 4,
  "fable-5": 9,
  "composer-2-5": 7,
  "opus-4-8": 8,
  "gemini-3-7-flash": 10,
  // Keep GPT-5.5 on the teal slot now that Fable owns olive.
  "gpt-5-5": 5,
};

/** Stable slots for every family in the curated AA default view. */
const STABLE_MODEL_GROUP_SLOTS: Readonly<Record<string, number>> = {
  "deepseek-v4-flash-0731": 0,
  "opus-5": 1,
  "claude-opus-5": 1,
  "grok-4-6": 2,
  "gpt-5-6-luna": 3,
  "glm-5-3-flash": 4,
  "mimo-v2-5": 5,
  "gpt-5-6-sol": 6,
  "qwen3-8-flash-next": 7,
  "glm-5-3": 8,
  "fable-5-1": 9,
  "gemini-3-8-flash": 10,
  "deepseek-v4-pro-0813": 11,
  "kimi-k3": 12,
  "qwen3-8-max": 13,
  "muse-spark-1-3": 14,
  "gemini-3-1-pro-preview": 15,
  "minimax-m3": 16,
  "gpt-6-astra": 17,
  sonnet: 8,
};

function canonicalGroupKey(groupKey: string): string {
  return groupKey.replace(/^effort:/, "").trim().toLocaleLowerCase();
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

// Preferred family rules intentionally match normalized family keys rather
// than today's model IDs. This keeps newly discovered DeepSeek and Opus
// variants on their reserved, color-blind-compliant palette slots.
const PREFERRED_MODEL_GROUP_SLOTS: readonly [RegExp, number][] = [
  [/^deepseek(?:-|$)/, 0], // blue / sky blue
  [/^opus(?:-|$)/, 1], // orange
  [/(?:^|-)sol(?:-|$)/, 6], // gold; intentionally far from DeepSeek blue
  [/^gemini(?:-|$)/, 10], // violet; intentionally far from Sol teal
  [/^glm-5-3-flash(?:-|$)/, 4], // purple; intentionally far from DeepSeek blue
  [/^glm(?:-|$)/, 8], // brown for other GLM families
];

function preferredModelGroupSlot(key: string): number | undefined {
  return PREFERRED_MODEL_GROUP_SLOTS.find(([pattern]) => pattern.test(key))?.[1];
}

function stableModelGroupSlot(key: string, paletteLength: number): number {
  return STABLE_MODEL_GROUP_SLOTS[key] ?? preferredModelGroupSlot(key) ?? WELL_KNOWN_GROUP_SLOTS[key] ??
    stableHash(key) % paletteLength;
}

/**
 * Stable family color shared by dots, connectors, arrows, and both charts.
 * Known curated families have fixed slots; other families use a stable hash
 * slot. A finite palette can still collide, but adding a model cannot recolor
 * an existing family or send every overflow family to the first slot.
 */
export function modelGroupColors(
  groupKeys: readonly string[],
  dark: boolean,
): ReadonlyMap<string, string> {
  const palette = dark ? COLOR_BLIND_MODEL_GROUP_PALETTE.dark : COLOR_BLIND_MODEL_GROUP_PALETTE.light;
  const assignments = new Map<string, string>();

  groupKeys.forEach((groupKey) => {
    const key = canonicalGroupKey(groupKey);
    assignments.set(groupKey, palette[stableModelGroupSlot(key, palette.length)]!);
  });
  return assignments;
}

export function modelGroupColor(groupKey: string, dark: boolean): string {
  const palette = dark ? COLOR_BLIND_MODEL_GROUP_PALETTE.dark : COLOR_BLIND_MODEL_GROUP_PALETTE.light;
  return palette[stableModelGroupSlot(canonicalGroupKey(groupKey), palette.length)]!;
}

/** Backwards-compatible name for effort-variant connection colors. */
export function effortGroupColor(groupKey: string, dark: boolean): string {
  return modelGroupColor(groupKey, dark);
}

/** Stable fallback colors use the same color-blind-compliant family palette. */
export function modelBrandColor(brand: ModelBrand, dark: boolean): string {
  return modelGroupColor(brand, dark);
}
