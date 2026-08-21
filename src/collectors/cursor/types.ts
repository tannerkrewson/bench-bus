/**
 * Raw (pre-canonical) Cursor eval row as scraped from the single benchmark
 * table at https://cursor.com/evals.
 *
 * RAW vs DERIVED: these values are parsed straight from the published table
 * (display-rounded upstream). Derived fields — canonical record mapping, the
 * first-party/third-party classification, and the optional $0.25/M-token
 * third-party surcharge — are computed in normalize.ts / surcharge.ts and are
 * never written back into these raw rows.
 */
export interface RawCursorEvalRow {
  /** 1-based rank as displayed (informational; not part of the canonical record). */
  rank: number;
  /** Display name exactly as published, including effort level (e.g. "Opus 5 Max"). */
  modelName: string;
  /** Published CursorBench score as displayed, e.g. 70.8 (percent). */
  scorePercent: number;
  /** Published average cost per task, USD, as displayed (e.g. 2.81). */
  costPerTaskUsd: number;
  /** Published average tokens per task, as displayed (e.g. 41136). */
  tokensPerTask: number;
  /** Published average steps per task, as displayed (e.g. 46). */
  stepsPerTask: number;
  /** The raw cell strings the numbers were parsed from (diagnostics + raw retention). */
  rawCells: string[];
}

/**
 * One scatter point of the inline CursorBench SVG chart. The chart carries the
 * same score/cost values as the table in machine-readable aria-labels, so it
 * is used as an independent cross-check of the table parse.
 */
export interface RawCursorSvgPoint {
  modelName: string;
  scorePercent: number;
  costPerTaskUsd: number;
}

/** Thrown when the page structure changed or a row is incomplete. */
export class CursorParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CursorParseError";
  }
}
