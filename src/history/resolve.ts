import type { BundleIndex, BundleIndexEntry, SourceFreshness, TimeTravelState, TimeTravelView } from "./types";

/**
 * Pure point-in-time resolution for historical time travel.
 *
 * The bundle index lists every compiled time. A selected time resolves to the
 * newest compiled entry at or before it; `null` (the "latest" sentinel)
 * resolves to the newest entry. A selection older than the first collected
 * snapshot is pre-history: Bench Bus history begins at the first collection,
 * and nothing older is implied to exist.
 */

/** Sort entries by asOf ascending (defensive copy; the index is sorted at build time). */
function sortedEntries(index: BundleIndex): BundleIndexEntry[] {
  return [...index.entries].sort((a, b) => a.asOf.localeCompare(b.asOf));
}

/** All compiled times, ascending — the time selector's options. */
export function availableTimes(index: BundleIndex): string[] {
  return sortedEntries(index).map((e) => e.asOf);
}

/**
 * Resolve a time-travel selection against the bundle index.
 *
 * - `state.selectedAsOf === null` → newest entry (`isLatest`).
 * - Selection at or after the newest entry → newest entry, still `isLatest`
 *   (an explicit future/now selection is equivalent to latest).
 * - Selection before the first entry → `preHistory` with no entry.
 * - Otherwise → newest entry at or before the selection.
 */
export function resolveTimeTravel(index: BundleIndex, state: Readonly<TimeTravelState>): TimeTravelView {
  const entries = sortedEntries(index);
  const available = availableTimes(index);
  const selected = state.selectedAsOf;

  if (entries.length === 0) {
    return { entry: null, isLatest: true, preHistory: selected !== null, availableTimes: available };
  }

  if (selected === null) {
    return { entry: entries[entries.length - 1] as BundleIndexEntry, isLatest: true, preHistory: false, availableTimes: available };
  }

  const first = entries[0] as BundleIndexEntry;
  if (selected.localeCompare(first.asOf) < 0) {
    return { entry: null, isLatest: false, preHistory: true, availableTimes: available };
  }

  // Newest entry at or before the selection.
  let entry: BundleIndexEntry = first;
  for (const candidate of entries) {
    if (candidate.asOf.localeCompare(selected) <= 0) entry = candidate;
    else break;
  }
  const isLatest = entry.asOf === entries[entries.length - 1]!.asOf;
  return { entry, isLatest, preHistory: false, availableTimes: available };
}

/**
 * Per-source freshness from a decoded derived bundle (see
 * `decodeBundle` in src/derived/encode.ts): each source resolved
 * independently, so observation times differ across sources and may be
 * absent entirely when a source had no snapshot at or before the bundle's
 * point in time.
 */
export function freshnessFromBundle(bundle: {
  sources: { aa: { available: boolean; observedAt?: string }; openrouter: { available: boolean; observedAt?: string }; cursor: { available: boolean; observedAt?: string } };
}): SourceFreshness[] {
  return [
    { source: "aa", available: bundle.sources.aa.available, observedAt: bundle.sources.aa.observedAt },
    { source: "openrouter", available: bundle.sources.openrouter.available, observedAt: bundle.sources.openrouter.observedAt },
    { source: "cursor", available: bundle.sources.cursor.available, observedAt: bundle.sources.cursor.observedAt },
  ];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Deterministic short UTC display for an ISO timestamp, e.g. "Aug 21, 02:14 UTC". */
export function formatObservedUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** Humanized non-negative age between an observation and now, e.g. "5h ago". */
export function relativeAge(observedAt: string, now: string): string {
  const diffMs = new Date(now).getTime() - new Date(observedAt).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Display names for sources, used in freshness wording. */
export const SOURCE_LABELS: Record<SourceFreshness["source"], string> = {
  aa: "Artificial Analysis",
  openrouter: "OpenRouter pricing",
  cursor: "CursorBench",
};

/**
 * Plain-language freshness wording for one source. Delayed or missed cron
 * runs render as transparent staleness ("last sampled 5h ago"), not errors.
 */
export function stalenessLabel(freshness: Readonly<SourceFreshness>, now: string): string {
  if (!freshness.available || freshness.observedAt === undefined) {
    return "no data at this time";
  }
  return `last sampled ${relativeAge(freshness.observedAt, now)}`;
}
