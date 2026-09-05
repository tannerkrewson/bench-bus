/** The Artificial Analysis view represented by Bench Bus's AA chart. */
export const AA_DEFAULT_COST_MODE = "intelligence-vs-cost-per-task" as const;

/**
 * Reasoning models shown in the initial AA/OpenRouter chart view. Keep
 * upstream AA slugs verbatim so URL/session selections remain stable as the
 * catalog changes. Non-reasoning rows are excluded by the chart section.
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
  "gpt-6-astra-low",
  "gpt-6-astra-medium",
  "gpt-6-astra-high",
  "gpt-6-astra-xhigh",
  "gpt-6-astra",
  "gemini-3-8-flash",
  "gemini-3-1-pro-preview",
  // These AA slugs map to deepseek/deepseek-v4-flash-0731 and
  // deepseek/deepseek-v4-pro-0813 respectively.
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "glm-5-3",
  "glm-5-3-flash",
  "grok-4-6",
  "kimi-k3",
  "qwen3-8-flash-next",
  "qwen3-8-max",
  "minimax-m3",
  "mimo-v2-5-0424",
] as const;
