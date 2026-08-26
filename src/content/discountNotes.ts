/**
 * Copy for provider discounts that are not constant. Some providers — DeepSeek
 * is the canonical example — price off-peak usage with discount windows that
 * shift by the hour and typically end during Chinese working hours and on
 * weekends, so a collected snapshot may not match what a reader sees later.
 */

/** Identity fields of a model entry a note matcher can inspect. */
export interface DiscountNoteSubject {
  /** Stable model identity, e.g. an OpenRouter slug. */
  readonly id?: string;
  /** Human-readable display name. */
  readonly label?: string;
  /** Provider names to match (pricing provider, brand family, …). */
  readonly providers?: readonly (string | undefined)[];
}

interface TimeVaryingDiscountRule {
  /** Lowercased substrings matched against id, label, and providers. */
  readonly keywords: readonly string[];
  readonly note: string;
}

export const TIME_VARYING_DISCOUNT_NOTE =
  "Off-peak discounts change by the hour. They often end during working hours in China and on weekends.";

// Add rules here as more providers are confirmed to vary discounts over time.
const TIME_VARYING_RULES: readonly TimeVaryingDiscountRule[] = [
  { keywords: ["deepseek"], note: TIME_VARYING_DISCOUNT_NOTE },
];

/** Return the matching provider's note, or null when nothing applies. */
export function timeVaryingDiscountNote(
  subject: DiscountNoteSubject | null | undefined,
): string | null {
  if (!subject) return null;
  const haystacks = [subject.id, subject.label, ...(subject.providers ?? [])]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => value.toLowerCase());
  if (haystacks.length === 0) return null;
  const rule = TIME_VARYING_RULES.find((candidate) =>
    candidate.keywords.some((keyword) => haystacks.some((haystack) => haystack.includes(keyword))),
  );
  return rule?.note ?? null;
}
