/** The Artificial Analysis view represented by Bench Bus's AA chart. */
export const AA_DEFAULT_COST_MODE = "intelligence-vs-cost-per-task" as const;

/**
 * Models selected by Artificial Analysis's requested curated URL. Keep the
 * upstream slugs verbatim so URL/session selections remain stable as the
 * upstream catalog changes.
 */
export const AA_DEFAULT_MODEL_SLUGS = [
  "mimo-v2-5-pro",
  "gpt-5-6-luna-low",
  "gpt-5-6-sol-low",
  "gemini-3-5-flash-lite",
  "claude-opus-5-xhigh",
  "claude-opus-5-low",
  "mimo-v2-5-0424",
  "gpt-5-6-luna",
  "gpt-5-6-luna-medium",
  "gpt-5-6-sol-medium",
  "claude-opus-5-high",
  "deepseek-v4-pro",
  "gpt-5-6-luna-xhigh",
  "gpt-5-6-sol-high",
  "gpt-5-6-luna-high",
  "gemini-3-7-flash",
  "hy3",
  "claude-opus-5",
  "grok-4-6",
  "gpt-5-6-sol",
  "gpt-5-6-sol-xhigh",
  "gemini-3-7-flash-low",
  "gemini-3-7-flash-medium",
  "kimi-k3",
  "deepseek-v4-flash",
  "muse-spark-1-2",
  // Keep the explicitly curated model visible in the best-value defaults even
  // when it is not on AA's automatically computed frontier.
  "claude-opus-5-medium",
  "glm-5-3",
  "qwen3-8-27b",
] as const;
