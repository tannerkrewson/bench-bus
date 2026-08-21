/**
 * Format a number as a compact human-readable string, e.g. 1234 -> "1.2k".
 * Placeholder utility proving the test harness; real formatting utilities
 * (prices, token counts, dates) land with the data/chart issues.
 */
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
