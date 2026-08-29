/**
 * Explicit schema versions for every persisted or derived data format.
 *
 * Bump a version whenever a format changes in a way that old snapshots or
 * old derived assets cannot satisfy. Collectors stamp snapshots with the
 * version that produced them; the frontend refuses snapshots whose version
 * it does not understand.
 */
export const SCHEMA_VERSIONS = {
  /** Artificial Analysis canonical model records. */
  aa: 1,
  /** OpenRouter effective-pricing provider summaries. */
  openrouter: 1,
  /** DeepSWE leaderboard score records. */
  deepswe: 1,
  /** Cursor eval table records (cursor.com/evals). */
  cursor: 1,
  /** Snapshot envelope wrapping any source's records. */
  snapshot: 1,
  /** Snapshot manifest index stored on the data branch. */
  manifest: 1,
  /** Derived chart records compiled for the browser. */
  derived: 2,
} as const;

export type SchemaSource = keyof typeof SCHEMA_VERSIONS;
