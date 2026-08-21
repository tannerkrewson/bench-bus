import type { SnapshotSource } from "../schemas";

/**
 * Dedicated machine-generated history branch. Human-authored code lives on
 * the default branch; only immutable snapshots and manifests live here.
 * This branch is NEVER used to serve the site (that is GitHub Pages' job).
 */
export const DATA_BRANCH_NAME = "bench-bus-data";

const SEGMENT_RE = /^\d{8}T\d{6}Z$/;

/**
 * Convert an ISO UTC timestamp into the compact, filesystem- and URL-safe
 * segment used in deterministic snapshot paths, e.g.
 * `2026-08-21T01:53:42.500Z` -> `20260821T015342Z`.
 *
 * Sub-second precision is truncated (floor) so identical observations always
 * map to identical paths. Two snapshots for one source within the same second
 * collide by design; the store refuses to overwrite, so the second write
 * fails closed instead of rewriting history.
 */
export function observedAtToSegment(observedAt: string): string {
  const ms = Date.parse(observedAt);
  if (Number.isNaN(ms)) {
    throw new TypeError(`Invalid observedAt timestamp: ${observedAt}`);
  }
  const wholeSecond = new Date(Math.floor(ms / 1000) * 1000);
  return wholeSecond.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Inverse of {@link observedAtToSegment}: `20260821T015342Z` -> ISO UTC. */
export function segmentToObservedAt(segment: string): string {
  if (!SEGMENT_RE.test(segment)) {
    throw new TypeError(`Invalid path timestamp segment: ${segment}`);
  }
  const iso = `${segment.slice(0, 4)}-${segment.slice(4, 6)}-${segment.slice(6, 8)}T${segment.slice(9, 11)}:${segment.slice(11, 13)}:${segment.slice(13, 15)}.000Z`;
  if (Number.isNaN(Date.parse(iso))) {
    throw new TypeError(`Invalid path timestamp segment: ${segment}`);
  }
  return iso;
}

/**
 * Deterministic, repo-relative path of a snapshot on the data branch:
 * `snapshots/<source>/v<recordSchemaVersion>/<YYYYMMDDTHHMMSSZ>.json`.
 *
 * The record schema version is part of the path so differently-versioned
 * record formats never share a directory and old history stays readable
 * after a version bump.
 */
export function snapshotPath(
  source: SnapshotSource,
  recordSchemaVersion: number,
  observedAt: string,
): string {
  return `snapshots/${source}/v${recordSchemaVersion}/${observedAtToSegment(observedAt)}.json`;
}

/** Deterministic path of a source's manifest index on the data branch. */
export function manifestPath(source: SnapshotSource): string {
  return `manifests/${source}.json`;
}
