import type { DerivedAaChartRecord } from "../../schemas";

/**
 * Temporary data approved for the OpenRouter chart while AA catches up. This
 * is intentionally separate from collected AA records: it has no fabricated
 * AA token counts or per-token prices to leak into snapshots or the derived
 * wire format.
 */
export const TEMPORARY_OPENROUTER_SCORE_OVERRIDES = [
  {
    kind: "temporary-openrouter-score-override",
    openrouterId: "z-ai/glm-5.3-flash",
    displayName: "GLM 5.3 Flash",
    score: 57,
    discountedTaskCostUsd: 0.045,
  },
] as const;

export type TemporaryOpenRouterScoreOverride =
  (typeof TEMPORARY_OPENROUTER_SCORE_OVERRIDES)[number];

/** Browser-only chart record made from one explicit temporary override. */
export interface TemporaryAaChartRecord {
  readonly kind: "temporary-openrouter-score-override";
  readonly openrouterId: string;
  readonly name: string;
  readonly shortName: string;
  readonly intelligenceIndex: number;
  readonly discountedTaskCostUsd: number;
}

function normalizedIdentity(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Match a later AA row without requiring a code edit for its new slug. */
function matchesAaRecord(
  record: Pick<DerivedAaChartRecord, "slug" | "name" | "shortName">,
  override: TemporaryOpenRouterScoreOverride,
): boolean {
  const identity = normalizedIdentity(override.displayName);
  return [record.slug, record.name, record.shortName].some((value) =>
    normalizedIdentity(value).includes(identity),
  );
}

/**
 * Return temporary rows only while their real AA model row is absent. The
 * OpenRouter availability gate prevents a fallback from appearing in an
 * offline/no-pricing view.
 */
export function temporaryOpenRouterFallbackRecords(
  records: readonly Pick<DerivedAaChartRecord, "slug" | "name" | "shortName">[],
  openrouterAvailable: boolean,
): TemporaryAaChartRecord[] {
  if (!openrouterAvailable) return [];
  return TEMPORARY_OPENROUTER_SCORE_OVERRIDES.flatMap((override) => {
    if (records.some((record) => matchesAaRecord(record, override))) return [];
    return [{
      kind: override.kind,
      openrouterId: override.openrouterId,
      name: override.displayName,
      shortName: override.displayName,
      intelligenceIndex: override.score,
      discountedTaskCostUsd: override.discountedTaskCostUsd,
    }];
  });
}

export function isTemporaryAaChartRecord(
  record: unknown,
): record is TemporaryAaChartRecord {
  return typeof record === "object" && record !== null &&
    (record as { kind?: unknown }).kind === "temporary-openrouter-score-override";
}
