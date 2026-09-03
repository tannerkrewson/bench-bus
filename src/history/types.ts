/**
 * Historical time-travel state types.
 *
 * The browser loads one compact derived bundle per compiled point in time;
 * `index.json` (see src/derived/compile.ts) lists every compiled time. Time
 * travel means selecting one of those times; each data source inside the
 * chosen bundle resolved INDEPENDENTLY to its newest snapshot at or before
 * that time, so per-source observation times may differ and may be absent
 * (a source with no snapshot yet contributes no data — nothing is fabricated).
 */

/** Data source identifiers, matching the derived bundle's `sources` keys. */
export type SourceId = "aa" | "openrouter" | "deepswe" | "cursor";

/** One entry of the derived output index (mirrors src/derived/compile.ts). */
export interface BundleIndexEntry {
  asOf: string;
  /** File name relative to the derived output directory. */
  path: string;
  /** Whether the AA chart dataset exists at this time (requires an AA snapshot). */
  aa: boolean;
  /** Whether the Cursor chart dataset exists at this time. */
  cursor: boolean;
}

/** Parsed contents of the derived output `index.json`. */
export interface BundleIndex {
  v: number;
  entries: BundleIndexEntry[];
}

/** Selected point in time for time travel; `null` means "latest available". */
export interface TimeTravelState {
  selectedAsOf: string | null;
}

/** Per-source freshness as reported by a decoded derived bundle. */
export interface SourceFreshness {
  source: SourceId;
  available: boolean;
  /** Snapshot observation time; absent when the source had no eligible data. */
  observedAt?: string;
}

/** Resolved view of a time-travel selection against a bundle index. */
export interface TimeTravelView {
  /** The compiled bundle entry in effect (null when the selection predates history). */
  entry: BundleIndexEntry | null;
  /** True when viewing the newest compiled time (no explicit older selection in effect). */
  isLatest: boolean;
  /** True when the selected time predates the first collected snapshot. */
  preHistory: boolean;
  /** All compiled times, ascending — the time selector's options. */
  availableTimes: string[];
}
