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

// The color-blind palette is based on the Okabe-Ito hues, with darker
// light-theme variants and brighter dark-theme variants to preserve contrast
// against either chart surface. No slot is white or black, so points never
// disappear into a theme background.
/**
 * Color-blind family slots. These are exported so the contrast contract can
 * be tested without depending on a rendered browser canvas. Keep both arrays
 * the same length as WELL_KNOWN_GROUP_SLOTS below.
 *
 * The dark slots are intentionally lighter than the canonical Okabe-Ito
 * swatches. Aqua's base-100 surface is the brightest supported dark surface,
 * so every dark slot targets 4.5:1 there (the text-sized contrast threshold).
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
    "#245a9a", // indigo
    "#4f6d2f", // olive
    "#5b3f8c", // violet
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
    "#86bdf2", // indigo
    "#a6d854", // olive
    "#c2a0f5", // violet
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

/**
 * Stable family color shared by dots, connectors, arrows, and both charts.
 * `colorBlind` switches the complete shared palette, rather than changing
 * only dots, so every visual representation of a family remains aligned.
 */
export function modelGroupColor(groupKey: string, dark: boolean, colorBlind = false): string {
  const key = canonicalGroupKey(groupKey);
  const explicitSlot = WELL_KNOWN_GROUP_SLOTS[key];
  const palette = colorBlind
    ? (dark ? COLOR_BLIND_MODEL_GROUP_PALETTE.dark : COLOR_BLIND_MODEL_GROUP_PALETTE.light)
    : MODEL_GROUP_PALETTE;
  const slot = explicitSlot ?? stableHash(key) % palette.length;
  const color = palette[slot % palette.length]!;
  // Amber needs a little more luminance on dark backgrounds; it remains the
  // same family color in the two charts and is never replaced with white.
  if (!colorBlind && dark && color === "#ca8a04") return "#facc15";
  return color;
}

/** Backwards-compatible name for effort-variant connection colors. */
export function effortGroupColor(groupKey: string, dark: boolean, colorBlind = false): string {
  return modelGroupColor(groupKey, dark, colorBlind);
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
