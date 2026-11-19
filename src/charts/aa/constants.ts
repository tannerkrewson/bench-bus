/** The Artificial Analysis view represented by Bench Bus's AA chart. */
export const AA_DEFAULT_COST_MODE = "intelligence-vs-cost-per-task" as const;

/**
 * V5-era comparison set (reviewed 2026-11-17). Effort variants are discovered
 * from these exact source identities. The live score-and-cost Pareto frontier
 * is always added. Gemini models enter the default view through that frontier.
 * Unscored/retired models are never synthesized from an older index version.
 */
export const AA_DEFAULT_MODEL_SLUGS = [
  "gpt-6-luna",
  "gpt-6-1-terra",
  "gpt-6-2-sol",
  "gpt-6-2-astra",
  "claude-haiku-5-5",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "grok-4-7",
  "deepseek-v4-1-flash-1017",
  "mimo-v2-6-flash",
  "kimi-k3-1-pro",
] as const;

/**
 * Follow current product families automatically; dominated older releases
 * remain selector-only. Never infer pricing identity from a family policy.
 */
export const AA_DEFAULT_AUTO_RELEASE_FAMILY_POLICIES = [
  { seedSlug: "gpt-6-luna", hiddenSlugs: [] },
  { seedSlug: "gpt-6-1-terra", hiddenSlugs: [] },
  { seedSlug: "gpt-6-2-sol", hiddenSlugs: [] },
  { seedSlug: "gpt-6-2-astra", hiddenSlugs: [] },
  { seedSlug: "claude-haiku-5-5", hiddenSlugs: [] },
  { seedSlug: "claude-opus-5-5", hiddenSlugs: [] },
  { seedSlug: "claude-sonnet-5-5", hiddenSlugs: [] },
  { seedSlug: "grok-4-7", hiddenSlugs: [] },
  { seedSlug: "deepseek-v4-1-flash-1017", hiddenSlugs: [] },
  { seedSlug: "mimo-v2-6-flash", hiddenSlugs: [] },
  { seedSlug: "kimi-k3-1-pro", hiddenSlugs: [] },
  { seedSlug: "minimax-m3", hiddenSlugs: ["minimax-m3"] },
] as const;
