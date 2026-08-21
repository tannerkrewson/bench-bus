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
 * Brand colors are intentionally recognizable, with neutral brands adapting
 * to the active theme so black OpenAI points remain visible in dark mode.
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
