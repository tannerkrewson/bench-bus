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
  "deepseek-v4-flash-0731": 9,
  "gemini-3-7-flash": 10,
  // Keep GPT-5.5 on the teal slot now that Fable owns olive.
  "gpt-5-5": 5,
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

type LabColor = readonly [number, number, number];

/** Convert an sRGB palette entry to CIE Lab for perceptual spacing. */
function hexToLab(hex: string): LabColor {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  const [red, green, blue] = linear;
  const x = (red! * 0.4124 + green! * 0.3576 + blue! * 0.1805) / 0.95047;
  const y = red! * 0.2126 + green! * 0.7152 + blue! * 0.0722;
  const z = (red! * 0.0193 + green! * 0.1192 + blue! * 0.9505) / 1.08883;
  const pivot = (value: number) => value > 0.008856
    ? value ** (1 / 3)
    : 7.787 * value + 16 / 116;
  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function perceptualColorDistance(first: LabColor, second: LabColor): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
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

/**
 * Stable family color shared by dots, connectors, arrows, and both charts.
 * The only palette is the color-blind-compliant palette above, so every
 * visual representation of a family remains aligned in either theme.
 */
/**
 * Allocate colors for all families visible in one chart at once. Preferred
 * slots are honored first, then stable hash slots are linearly probed so a
 * newly added family cannot silently reuse a visible family's color.
 */
export function modelGroupColors(
  groupKeys: readonly string[],
  dark: boolean,
): ReadonlyMap<string, string> {
  const palette = dark ? COLOR_BLIND_MODEL_GROUP_PALETTE.dark : COLOR_BLIND_MODEL_GROUP_PALETTE.light;
  const canonicalKeys = [...new Set(groupKeys.map(canonicalGroupKey))].filter(Boolean).sort();
  const assignments = new Map<string, string>();
  const usedSlots = new Set<number>();
  const slots = new Map<string, number>();

  const reserve = (key: string, preferred: number | undefined): boolean => {
    if (preferred === undefined || usedSlots.has(preferred) || preferred >= palette.length) return false;
    slots.set(key, preferred);
    usedSlots.add(preferred);
    return true;
  };

  canonicalKeys.forEach((key) => {
    reserve(key, preferredModelGroupSlot(key) ?? WELL_KNOWN_GROUP_SLOTS[key]);
  });
  const paletteLab = palette.map(hexToLab);
  canonicalKeys.forEach((key) => {
    if (slots.has(key)) return;
    let bestSlot: number | undefined;
    let bestDistance = -Infinity;
    let bestTieBreak = -Infinity;
    for (let candidate = 0; candidate < palette.length; candidate += 1) {
      if (usedSlots.has(candidate)) continue;
      const distance = usedSlots.size === 0
        ? Infinity
        : Math.min(...[...usedSlots].map((slot) => perceptualColorDistance(paletteLab[candidate]!, paletteLab[slot]!)));
      // Maximize the distance from every already-assigned family. Stable hash
      // tie-breaking keeps equal-distance choices deterministic without
      // sacrificing the perceptual separation objective.
      const tieBreak = stableHash(`${key}:${candidate}`);
      if (distance > bestDistance || (distance === bestDistance && tieBreak > bestTieBreak)) {
        bestSlot = candidate;
        bestDistance = distance;
        bestTieBreak = tieBreak;
      }
    }
    if (bestSlot !== undefined) {
      slots.set(key, bestSlot);
      usedSlots.add(bestSlot);
      return;
    }
    // The palette currently has more slots than any supported chart. If a
    // future feed exceeds that capacity, choose the most separated existing
    // slot deterministically rather than introducing a non-palette color.
    let fallbackSlot = 0;
    let fallbackDistance = -Infinity;
    for (let candidate = 0; candidate < palette.length; candidate += 1) {
      const distance = Math.min(...[...usedSlots].map((slot) =>
        perceptualColorDistance(paletteLab[candidate]!, paletteLab[slot]!)));
      if (distance > fallbackDistance) {
        fallbackSlot = candidate;
        fallbackDistance = distance;
      }
    }
    slots.set(key, fallbackSlot);
  });

  groupKeys.forEach((groupKey) => {
    const key = canonicalGroupKey(groupKey);
    const slot = slots.get(key);
    if (slot !== undefined) assignments.set(groupKey, palette[slot]!);
  });
  return assignments;
}

export function modelGroupColor(groupKey: string, dark: boolean): string {
  return modelGroupColors([groupKey], dark).get(groupKey) ??
    (dark ? COLOR_BLIND_MODEL_GROUP_PALETTE.dark : COLOR_BLIND_MODEL_GROUP_PALETTE.light)[0]!;
}

/** Backwards-compatible name for effort-variant connection colors. */
export function effortGroupColor(groupKey: string, dark: boolean): string {
  return modelGroupColor(groupKey, dark);
}

/** Stable fallback colors use the same color-blind-compliant family palette. */
export function modelBrandColor(brand: ModelBrand, dark: boolean): string {
  return modelGroupColor(brand, dark);
}
