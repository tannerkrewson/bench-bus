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

/** Stable colors for connected effort groups; provider identity is not encoded. */
const EFFORT_GROUP_PALETTE = [
  "#2563eb", "#c2410c", "#15803d", "#7c3aed", "#be123c", "#0f766e", "#a16207", "#4338ca",
] as const;

export function effortGroupColor(groupKey: string, dark: boolean): string {
  let hash = 0;
  for (let index = 0; index < groupKey.length; index += 1) hash = (hash * 31 + groupKey.charCodeAt(index)) | 0;
  const color = EFFORT_GROUP_PALETTE[Math.abs(hash) % EFFORT_GROUP_PALETTE.length]!;
  return dark && color === "#a16207" ? "#facc15" : color;
}

/**
 * Legacy metadata colors retained for labels that do not belong to an effort
 * group. They are not used for dot or connector series.
 */
export function modelBrandColor(brand: ModelBrand, dark: boolean): string {
  switch (brand) {
    case "anthropic":
      return "#d97757";
    case "openai":
      return dark ? "#f8fafc" : "#111111";
    case "google":
      return "#4285f4";
    case "cursor":
      return dark ? "#c4b5fd" : "#6d28d9";
    case "meta":
      return "#0866ff";
    case "mistral":
      return "#f97316";
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
