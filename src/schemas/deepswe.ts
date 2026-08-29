import { z } from "zod";
import { finiteNumber, isoUtcTimestamp, nonEmptyString } from "./primitives";

const passRate = finiteNumber.refine((value) => value >= 0 && value <= 1, {
  message: "pass rate must be between 0 and 1",
});

/** One normalized DeepSWE leaderboard row. Field names are canonical camelCase. */
export const deepSweScoreRecordSchema = z
  .object({
    model: nonEmptyString,
    harness: nonEmptyString,
    reasoningEffort: nonEmptyString.nullable(),
    config: nonEmptyString,
    passRate,
    passAt1: passRate,
    passAt4: passRate,
    nPassed: z.number().int().nonnegative(),
    nAttempted: z.number().int().nonnegative(),
    nTasksAttempted: z.number().int().nonnegative(),
    nTasksPassedAny: z.number().int().nonnegative(),
    ciPassed: z.number().int().nonnegative(),
    ciAttempted: z.number().int().nonnegative(),
    ciLo: passRate,
    ciHi: passRate,
    ciHalf: finiteNumber,
    nRuns: z.number().int().positive().nullable(),
    ciMethod: nonEmptyString,
    meanCostUsd: finiteNumber,
    medianCostUsd: finiteNumber,
    meanOutputTokens: finiteNumber,
    medianOutputTokens: finiteNumber,
    meanInputTokens: finiteNumber,
    medianInputTokens: finiteNumber,
    meanDurationSeconds: finiteNumber,
    medianDurationSeconds: finiteNumber,
    meanAgentSteps: finiteNumber,
    medianAgentSteps: finiteNumber,
    medianPeakContextTokens: finiteNumber,
    medianOutputTokensToPass: finiteNumber,
  })
  .strict();

export type DeepSweScoreRecord = z.infer<typeof deepSweScoreRecordSchema>;

/** Source metadata stamped onto every DeepSWE snapshot. */
export const deepSweSourceMetadataSchema = z
  .object({
    source: z.literal("deepswe"),
    endpointUrl: z.string().url(),
    generatedAt: isoUtcTimestamp,
    nTasksInSet: z.number().int().positive(),
  })
  .strict();

export type DeepSweSourceMetadata = z.infer<typeof deepSweSourceMetadataSchema>;

/** Full normalized DeepSWE snapshot payload emitted by the collector. */
export const deepSweSnapshotPayloadSchema = z
  .object({
    observedAt: isoUtcTimestamp,
    source: deepSweSourceMetadataSchema,
    records: z.array(deepSweScoreRecordSchema),
  })
  .refine(
    (payload) => {
      const keys = payload.records.map((record) =>
        `${record.model}\u0000${record.harness}\u0000${record.reasoningEffort ?? ""}`,
      );
      return new Set(keys).size === keys.length;
    },
    { message: "duplicate DeepSWE model configuration entries in snapshot" },
  );

export type DeepSweSnapshotPayload = z.infer<typeof deepSweSnapshotPayloadSchema>;

/** Validate and deterministically order DeepSWE records before persistence. */
export function validateDeepSweScoreCollection(records: unknown): DeepSweScoreRecord[] {
  if (!Array.isArray(records)) throw new TypeError("DeepSWE score collection must be an array");
  const seen = new Map<string, number>();
  const parsed = records.map((record, index) => {
    const result = deepSweScoreRecordSchema.safeParse(record);
    if (!result.success) {
      throw new Error(`Invalid DeepSWE score record at index ${index}: ${result.error.message}`);
    }
    const key = `${result.data.model}\u0000${result.data.harness}\u0000${result.data.reasoningEffort ?? ""}`;
    const firstAtIndex = seen.get(key);
    if (firstAtIndex !== undefined) {
      throw new Error(
        `Duplicate DeepSWE score identity "${key}" at indices ${firstAtIndex} and ${index}`,
      );
    }
    seen.set(key, index);
    return result.data;
  });
  return parsed.sort((a, b) =>
    `${a.model}\u0000${a.harness}\u0000${a.reasoningEffort ?? ""}`.localeCompare(
      `${b.model}\u0000${b.harness}\u0000${b.reasoningEffort ?? ""}`,
    ),
  );
}
