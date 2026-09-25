/** The Artificial Analysis view represented by Bench Bus's AA chart. */
export const AA_DEFAULT_COST_MODE = "intelligence-vs-cost-per-task" as const;

/**
 * Models shown in the initial AA/OpenRouter chart view. Keep upstream AA
 * slugs verbatim so URL/session selections remain stable as the catalog
 * changes. Non-reasoning rows are excluded by the chart section.
 */
export const AA_DEFAULT_MODEL_SLUGS = [
  "gpt-5-6-luna-low",
  "gpt-5-6-luna",
  "gpt-5-6-luna-medium",
  "gpt-5-6-luna-high",
  "gpt-5-6-luna-xhigh",
  "gpt-5-6-sol-low",
  "gpt-5-6-sol-medium",
  "gpt-5-6-sol-high",
  "gpt-5-6-sol-xhigh",
  "gpt-5-6-sol",
  "muse-spark-1-3-xhigh",
  "claude-opus-5-high",
  "claude-opus-5",
  "claude-opus-5-xhigh",
  "claude-fable-5-1-high",
  "claude-fable-5-1-xhigh",
  "claude-fable-5-1",
  "gpt-6-astra",
  "gemini-3-8-flash",
  // Keep only the current DeepSeek release in the implicit view. Older
  // DeepSeek rows remain available through the selector when explicitly
  // requested.
  "deepseek-v4-1-flash",
  "glm-5-3-flash",
  "grok-4-7",
  "mimo-v2-6-pro",
] as const;

/**
 * Families whose latest plottable release should follow the source catalog
 * automatically. Hidden IDs are retained as selector-only rows, while a
 * newer release in the same normalized family is admitted without another
 * code change.
 */
export const AA_DEFAULT_AUTO_RELEASE_FAMILY_POLICIES = [
  { seedSlug: "gpt-5-6-luna", hiddenSlugs: [] },
  { seedSlug: "gpt-5-6-sol", hiddenSlugs: [] },
  { seedSlug: "claude-opus-5", hiddenSlugs: [] },
  { seedSlug: "grok-4-7", hiddenSlugs: [] },
  {
    seedSlug: "gemini-3-1-pro-preview",
    hiddenSlugs: ["gemini-2-5-pro", "gemini-3-1-pro-preview"],
  },
  { seedSlug: "minimax-m3", hiddenSlugs: ["minimax-m3"] },
] as const;
