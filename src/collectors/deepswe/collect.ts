import { readFile, rename, writeFile } from "node:fs/promises";
import { fetchJson, type FetchJsonOptions } from "../openrouter/api";
import {
  deepSweSnapshotPayloadSchema,
  validateDeepSweScoreCollection,
  type DeepSweScoreRecord,
  type DeepSweSnapshotPayload,
} from "../../schemas/deepswe";
import {
  DEEPSWE_LEADERBOARD_URL,
  rawDeepSweLeaderboardSchema,
  type RawDeepSweLeaderboard,
  type RawDeepSweRow,
} from "./api";

export const DEEPSWE_SOURCE_METADATA = {
  source: "deepswe",
  endpointUrl: DEEPSWE_LEADERBOARD_URL,
} as const;

export interface CollectDeepSweOptions {
  timeoutMs?: number;
  retries?: number;
  backoffBaseMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

function normalizeRow(row: RawDeepSweRow): DeepSweScoreRecord {
  return {
    model: row.model,
    harness: row.harness,
    reasoningEffort: row.reasoning_effort,
    config: row.config,
    passRate: row.pass_rate,
    passAt1: row.pass_at_1,
    passAt4: row.pass_at_4,
    nPassed: row.n_passed,
    nAttempted: row.n_attempted,
    nTasksAttempted: row.n_tasks_attempted,
    nTasksPassedAny: row.n_tasks_passed_any,
    ciPassed: row.ci_passed,
    ciAttempted: row.ci_attempted,
    ciLo: row.ci_lo,
    ciHi: row.ci_hi,
    ciHalf: row.ci_half,
    nRuns: row.n_runs,
    ciMethod: row.ci_method,
    meanCostUsd: row.mean_cost_usd,
    medianCostUsd: row.median_cost_usd,
    meanOutputTokens: row.mean_output_tokens,
    medianOutputTokens: row.median_output_tokens,
    meanInputTokens: row.mean_input_tokens,
    medianInputTokens: row.median_input_tokens,
    meanDurationSeconds: row.mean_duration_seconds,
    medianDurationSeconds: row.median_duration_seconds,
    meanAgentSteps: row.mean_agent_steps,
    medianAgentSteps: row.median_agent_steps,
    medianPeakContextTokens: row.median_peak_context_tokens,
    medianOutputTokensToPass: row.median_output_tokens_to_pass,
  };
}

function generatedAtIso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`DeepSWE generated_at is not a timestamp: ${value}`);
  return parsed.toISOString();
}

/** Normalize a validated raw leaderboard response through the shared schema. */
export function collectFromLeaderboard(
  raw: RawDeepSweLeaderboard,
  observedAt: string,
): DeepSweSnapshotPayload {
  const records = validateDeepSweScoreCollection(raw.rows.map(normalizeRow));
  return deepSweSnapshotPayloadSchema.parse({
    observedAt,
    source: {
      ...DEEPSWE_SOURCE_METADATA,
      generatedAt: generatedAtIso(raw.generated_at),
      nTasksInSet: raw.n_tasks_in_set,
    },
    records,
  });
}

/** Fetch and normalize the live DeepSWE leaderboard. */
export async function collectDeepSwe(
  options: CollectDeepSweOptions = {},
): Promise<{ payload: DeepSweSnapshotPayload }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const fetchOptions: FetchJsonOptions = {
    timeoutMs: options.timeoutMs ?? 20_000,
    retries: options.retries ?? 2,
    backoffBaseMs: options.backoffBaseMs ?? 500,
    fetchImpl,
  };
  const raw = await fetchJson(DEEPSWE_LEADERBOARD_URL, rawDeepSweLeaderboardSchema, fetchOptions);
  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  return { payload: collectFromLeaderboard(raw, observedAt) };
}

/** Write a schema-validated payload atomically for snapshot write to consume. */
export async function writeSnapshotPayload(
  payload: DeepSweSnapshotPayload,
  outPath: string,
): Promise<void> {
  const validated = deepSweSnapshotPayloadSchema.parse(payload);
  const tmpPath = `${outPath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  await rename(tmpPath, outPath);
}

/** Read a fixture or captured response and normalize it without a network call. */
export async function collectFromJsonFile(path: string, observedAt: string): Promise<DeepSweSnapshotPayload> {
  const raw = rawDeepSweLeaderboardSchema.parse(JSON.parse(await readFile(path, "utf8")));
  return collectFromLeaderboard(raw, observedAt);
}
