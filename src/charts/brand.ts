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
  if (/(llama|meta)/.test(haystack)) return "meta";
  if (/mistral/.test(haystack)) return "mistral";
  if (/deepseek/.test(haystack)) return "deepseek";
  if (/(qwen|alibaba)/.test(haystack)) return "qwen";
  if (/(grok|xai)/.test(haystack)) return "xai";
  return "other";
}

/**
 * A curated, high-contrast palette for model families. Colors are deliberately
 * never white: dots and their connecting lines must remain visible in both
 * themes. The well-known families have explicit slots so a new chart subset
 * cannot make Opus and Sonnet (or two other families) collide.
 */
const MODEL_GROUP_PALETTE = [
  "#e11d48", // rose
  "#ea580c", // orange
  "#ca8a04", // amber
  "#16a34a", // green
  "#0891b2", // cyan
  "#2563eb", // blue
  "#7c3aed", // violet
  "#db2777", // pink
  "#0f766e", // teal
  "#65a30d", // lime
  "#c026d3", // fuchsia
  "#0284c7", // sky
  "#9333ea", // purple
  "#dc2626", // red
  "#4f46e5", // indigo
  "#15803d", // forest
] as const;

const WELL_KNOWN_GROUP_SLOTS: Readonly<Record<string, number>> = {
  "opus-5": 0,
  "sonnet-5": 1,
  "grok-4-6": 2,
  luna: 3,
  sol: 4,
  terra: 5,
  "fable-5": 6,
  "composer-2-5": 7,
  "opus-4-8": 8,
  "deepseek-v4-flash-0731": 9,
  "gemini-3-7-flash": 10,
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

/** Stable family color shared by dots, connectors, arrows, and both charts. */
export function modelGroupColor(groupKey: string, dark: boolean): string {
  const key = canonicalGroupKey(groupKey);
  const explicitSlot = WELL_KNOWN_GROUP_SLOTS[key];
  const slot = explicitSlot ?? stableHash(key) % MODEL_GROUP_PALETTE.length;
  const color = MODEL_GROUP_PALETTE[slot % MODEL_GROUP_PALETTE.length]!;
  // Amber needs a little more luminance on dark backgrounds; it remains the
  // same family color in the two charts and is never replaced with white.
  if (dark && color === "#ca8a04") return "#facc15";
  return color;
}

/** Backwards-compatible name for effort-variant connection colors. */
export function effortGroupColor(groupKey: string, dark: boolean): string {
  return modelGroupColor(groupKey, dark);
}

/** Stable fallback colors for ungrouped/provider-only UI elements. */
export function modelBrandColor(brand: ModelBrand, dark: boolean): string {
  switch (brand) {
    case "anthropic":
      return "#d97757";
    case "openai":
      return dark ? "#f8fafc" : "#111111";
    case "google":
      return "#2563eb";
    case "cursor":
      return dark ? "#c4b5fd" : "#6d28d9";
    case "meta":
      return "#0866ff";
    case "mistral":
      return "#ea580c";
    case "deepseek":
      return "#4f7cff";
    case "qwen":
      return "#8b5cf6";
    case "xai":
      return dark ? "#f8fafc" : "#111827";
    case "other":
      return dark ? "#cbd5e1" : "#475569";
  }
}
