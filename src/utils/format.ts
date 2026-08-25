/**
 * Format a number as a compact human-readable string, e.g. 1234 -> "1.2k".
 * Placeholder utility proving the test harness; real formatting utilities
 * (prices, token counts, dates) land with the data/chart issues.
 */
/** Format a benchmark score tick with a percent unit, without changing the value. */
export function formatPercentTick(value: number): string {
  if (!Number.isFinite(value)) return "";
  return `${trim(value)}%`;
}

/** Format a USD axis tick with a dollar unit and compact precision. */
export function formatDollarTick(value: number): string {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${trim(value / 1_000_000)}M`;
  if (abs >= 1_000) return `$${trim(value / 1_000)}k`;
  if (abs > 0 && abs < 0.01) return `$${value.toExponential(1)}`;
  return `$${trim(value)}`;
}

export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${trim(value / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(value / 1_000)}k`;
  return `${trim(value)}`;
}

function trim(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/**
 * Format an ISO UTC timestamp for "last updated" UI, e.g.
 * "Aug 23, 2026, 10:30 PM UTC". Invalid input yields null so callers can
 * omit the line entirely instead of printing a broken date.
 */
export function formatLastUpdated(isoTimestamp: string | null | undefined): string | null {
  if (!isoTimestamp) return null;
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return null;
  const formatted = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
  return `${formatted} UTC`;
}

/** Latest of the given ISO timestamps (null when none is valid). */
export function latestIsoTimestamp(
  timestamps: readonly (string | null | undefined)[],
): string | null {
  let latest: string | null = null;
  let latestTime = -Infinity;
  for (const timestamp of timestamps) {
    if (!timestamp) continue;
    const time = new Date(timestamp).getTime();
    if (!Number.isNaN(time) && time > latestTime) {
      latestTime = time;
      latest = timestamp;
    }
  }
  return latest;
}
