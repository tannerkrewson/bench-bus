/** The Artificial Analysis view represented by Bench Bus's AA chart. */
export const AA_DEFAULT_COST_MODE = "intelligence-vs-cost-per-task" as const;

/**
 * V5-era comparison set (reviewed 2026-10-28). Effort variants are discovered
 * from these exact source identities. The live cheapest-price Pareto frontier
 * is always added, including new families not explicitly curated here.
 * Unscored/retired models are never synthesized from an older index version.
 */
export const AA_DEFAULT_MODEL_SLUGS = [
  "gpt-6-luna",
  "gpt-6-1-terra",
  "gpt-6-1-sol",
  "gpt-6-astra",
  "claude-haiku-5-5",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "gemini-4-argon",
  "grok-4-7",
  "deepseek-v4-1-flash-1017",
  "mimo-v2-6-flash",
  "mimo-v2-6-pro",
  "kimi-k3-1-pro",
  "minimax-m3-1-flash",
] as const;

/**
 * Follow current product families automatically; dominated older releases
 * remain selector-only. Never infer pricing identity from a family policy.
 */
export const AA_DEFAULT_AUTO_RELEASE_FAMILY_POLICIES = [
  { seedSlug: "gpt-6-luna", hiddenSlugs: [] },
  { seedSlug: "gpt-6-1-terra", hiddenSlugs: [] },
  { seedSlug: "gpt-6-1-sol", hiddenSlugs: [] },
  { seedSlug: "gpt-6-astra", hiddenSlugs: [] },
  { seedSlug: "claude-haiku-5-5", hiddenSlugs: [] },
  { seedSlug: "claude-opus-5-5", hiddenSlugs: [] },
  { seedSlug: "claude-sonnet-5-5", hiddenSlugs: [] },
  { seedSlug: "gemini-4-argon", hiddenSlugs: [] },
  { seedSlug: "grok-4-7", hiddenSlugs: [] },
  { seedSlug: "deepseek-v4-1-flash-1017", hiddenSlugs: [] },
  { seedSlug: "mimo-v2-6-flash", hiddenSlugs: [] },
  { seedSlug: "mimo-v2-6-pro", hiddenSlugs: [] },
  { seedSlug: "kimi-k3-1-pro", hiddenSlugs: [] },
  { seedSlug: "minimax-m3-1-flash", hiddenSlugs: [] },
  // Preserve these older policies for historical views and future releases.
  {
    seedSlug: "gemini-3-1-pro-preview",
    hiddenSlugs: ["gemini-2-5-pro", "gemini-3-1-pro-preview"],
  },
  { seedSlug: "minimax-m3", hiddenSlugs: ["minimax-m3"] },
] as const;
