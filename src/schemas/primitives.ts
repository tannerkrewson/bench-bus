import { z } from "zod";

/**
 * A finite number preserved exactly as the upstream source returned it.
 *
 * zod's `z.number()` already rejects NaN; this also rejects Infinity so a
 * malformed upstream value cannot survive into a persisted snapshot.
 * We deliberately do NOT transform, round, or default these values.
 */
export const finiteNumber = z
  .number()
  .refine((v) => Number.isFinite(v), { message: "must be a finite number" });

/** Non-empty trimmed string used for identity fields (slugs, ids, names). */
export const nonEmptyString = z.string().trim().min(1);

/**
 * ISO 8601 UTC timestamp string, e.g. `2026-08-21T01:53:42.000Z`.
 * Stored as a string (not a Date) so snapshots serialize deterministically.
 */
export const isoUtcTimestamp = z
  .string()
  .refine(
    (v) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/.test(v) &&
      !Number.isNaN(Date.parse(v)),
    { message: "must be an ISO 8601 UTC timestamp ending in Z" },
  );

/**
 * Optional upstream value that may be absent but never null/garbage when
 * present. Collectors must drop records missing required fields rather than
 * inventing placeholder numbers, so optional means "upstream did not publish
 * this", not "unknown, treat as zero".
 */
export const optionalFiniteNumber = finiteNumber.optional();
