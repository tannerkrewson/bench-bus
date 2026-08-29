import { z } from "zod";
import { finiteNumber, nonEmptyString } from "../../schemas/primitives";

const sourceTimestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "must be a parseable timestamp",
});
const passRate = finiteNumber.refine((value) => value >= 0 && value <= 1, {
  message: "pass rate must be between 0 and 1",
});

/** Raw DeepSWE leaderboard row, retaining the upstream snake_case fields. */
export const rawDeepSweRowSchema = z
  .object({
    model: nonEmptyString,
    harness: nonEmptyString,
    reasoning_effort: nonEmptyString.nullable(),
    config: nonEmptyString,
    source: z.literal("deep-swe"),
    pass_rate: passRate,
    pass_at_1: passRate,
    pass_at_4: passRate,
    n_passed: z.number().int().nonnegative(),
    n_attempted: z.number().int().nonnegative(),
    n_tasks_attempted: z.number().int().nonnegative(),
    n_tasks_passed_any: z.number().int().nonnegative(),
    ci_passed: z.number().int().nonnegative(),
    ci_attempted: z.number().int().nonnegative(),
    ci_lo: passRate,
    ci_hi: passRate,
    ci_half: finiteNumber,
    n_runs: z.number().int().positive().nullable(),
    ci_method: nonEmptyString,
    mean_cost_usd: finiteNumber,
    median_cost_usd: finiteNumber,
    mean_output_tokens: finiteNumber,
    median_output_tokens: finiteNumber,
    mean_input_tokens: finiteNumber,
    median_input_tokens: finiteNumber,
    mean_duration_seconds: finiteNumber,
    median_duration_seconds: finiteNumber,
    mean_agent_steps: finiteNumber,
    median_agent_steps: finiteNumber,
    median_peak_context_tokens: finiteNumber,
    median_output_tokens_to_pass: finiteNumber,
  })
  .strict();

export type RawDeepSweRow = z.infer<typeof rawDeepSweRowSchema>;

export const rawDeepSweLeaderboardSchema = z
  .object({
    scope: nonEmptyString,
    unit: nonEmptyString,
    generated_at: sourceTimestamp,
    n_tasks_in_set: z.number().int().positive(),
    latest_job: z
      .object({
        name: nonEmptyString,
        finished_at: sourceTimestamp,
      })
      .strict(),
    rows: z.array(rawDeepSweRowSchema).min(1),
  })
  .strict();

export type RawDeepSweLeaderboard = z.infer<typeof rawDeepSweLeaderboardSchema>;

export const DEEPSWE_LEADERBOARD_URL =
  "https://deepswe.datacurve.ai/artifacts/v1/leaderboard-live.json";
