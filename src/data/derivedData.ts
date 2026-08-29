/**
 * Browser-side loader for the derived data bundles (bench-bus-0cd.12
 * integration). Fetches the derived output index and compact bundles that the
 * build pipeline publishes as static JSON, and decodes them through the real
 * schema-validating path.
 *
 * Until the first collected snapshots are compiled and deployed, fetches fail
 * (no derived-data directory exists yet); in that case the demo fixture bundle
 * is served so the site still works in dev and early deploys. The fixture path
 * is clearly labelled in the UI by the App.
 */
import {
  decodeBundle,
  encodeCursorDataset,
  encodeSourceAvailability,
  type DecodedBundle,
} from "../derived/encode";
import { SCHEMA_VERSIONS } from "../schemas";
import { parseDerivedIndex } from "../derived/compile";
import type { BundleIndex } from "../history/types";
import { makeAaBundleFixture } from "../charts/aa/fixtures";
import { CURSOR_FIXTURE_RECORDS } from "../charts/fixtures";

/** Default base URL for the compiled derived-data directory. */
export const DERIVED_DATA_BASE = "./derived-data";

/** Fetch + parse the derived output index. Throws on fetch/parse failure. */
export async function fetchDerivedIndex(base: string = DERIVED_DATA_BASE): Promise<BundleIndex> {
  const response = await fetch(`${base}/index.json`);
  if (!response.ok) {
    throw new Error(`derived index fetch failed: ${response.status}`);
  }
  const parsed = parseDerivedIndex(await response.text());
  return { v: parsed.v, entries: [...parsed.entries] };
}

/** Fetch + decode one compiled bundle by its index path. */
export async function fetchDerivedBundle(
  path: string,
  base: string = DERIVED_DATA_BASE,
): Promise<DecodedBundle> {
  const response = await fetch(`${base}/${path}`);
  if (!response.ok) {
    throw new Error(`derived bundle fetch failed (${path}): ${response.status}`);
  }
  return decodeBundle(JSON.parse(await response.text()));
}

/**
 * Demo bundle (fixture data, real encode/decode wire format) used until the
 * first collected snapshots deploy. Includes both AA and Cursor datasets.
 */
export function makeDemoBundle(): DecodedBundle {
  const raw = JSON.parse(JSON.stringify(makeAaBundleFixture())) as ReturnType<
    typeof makeAaBundleFixture
  >;
  const freshness = {
    schemaVersion: SCHEMA_VERSIONS.derived,
    asOf: raw.asOf,
    aaObservedAt: raw.asOf,
    openrouterObservedAt: raw.asOf,
    deepsweObservedAt: raw.asOf,
    cursorObservedAt: raw.asOf,
  };
  const cursor = encodeCursorDataset({
    freshness,
    records: [...CURSOR_FIXTURE_RECORDS],
  });
  if (!cursor) throw new Error("demo cursor encode failed");
  raw.sources.cursor = encodeSourceAvailability({ available: true, observedAt: raw.asOf });
  raw.sources.deepswe = encodeSourceAvailability({ available: true, observedAt: raw.asOf });
  raw.cursor = cursor;
  return decodeBundle(raw);
}

/** Demo index with a single "latest" entry matching the demo bundle. */
export function makeDemoIndex(): BundleIndex {
  const bundle = makeDemoBundle();
  return {
    v: SCHEMA_VERSIONS.derived,
    entries: [{ asOf: bundle.asOf, path: "demo.json", aa: true, cursor: true }],
  };
}
