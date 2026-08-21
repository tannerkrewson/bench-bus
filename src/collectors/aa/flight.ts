/**
 * Next.js Flight (RSC) payload extraction for Artificial Analysis model pages.
 *
 * AA model pages are Next.js App Router pages. The full all-models dataset is
 * embedded server-side as Flight rows inside
 * `<script>self.__next_f.push([1,"..."])</script>` blocks, so a plain first
 * load needs no `?_rsc=` navigation replay. The `_rsc` cache discriminator is
 * nevertheless discovered dynamically from the HTML (it appears on
 * prefetch/navigation URLs) so the collector never hard-codes it and can
 * construct the RSC endpoint it used for source metadata.
 *
 * Flight format notes (verified 2026-08, see docs/upstream-sources-research.md):
 * - Each push carries an arbitrary fragment of the flight stream; fragments
 *   must be concatenated in document order before parsing.
 * - The stream is newline-delimited rows of the form `<rowId>:<value>` where
 *   `<rowId>` is hex and `<value>` is JSON (text chunks use `Td8d,`-style
 *   length-prefixed headers instead).
 */

/** Matches one `self.__next_f.push([1,"..."])` script body's string literal. */
const FLIGHT_PUSH_PATTERN = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;

/**
 * Extract and concatenate all Flight string fragments from an AA model page.
 * Throws when the page contains no Flight payload (structure changed).
 */
export function extractFlightText(html: string): string {
  const fragments: string[] = [];
  for (const match of html.matchAll(FLIGHT_PUSH_PATTERN)) {
    // The captured group is a JSON string literal; decode the escapes.
    const literal = match[1];
    if (literal === undefined) continue;
    fragments.push(JSON.parse(literal) as string);
  }
  if (fragments.length === 0) {
    throw new Error(
      "No Next.js Flight payloads (self.__next_f.push scripts) found in page HTML; " +
        "the Artificial Analysis page structure may have changed.",
    );
  }
  return fragments.join("");
}

/**
 * Dynamically discover the current Next.js `_rsc` router-cache discriminator
 * from prefetch/navigation URLs embedded in the page. Returns null when the
 * page ships none (first loads legitimately may not), in which case the
 * collector uses the inline-payload path and records the plain page URL.
 */
export function discoverRscParam(html: string): string | null {
  // Look at href/url attributes and any inline URL containing the param.
  const pattern = /[?&]_rsc=([A-Za-z0-9._~%-]+)/g;
  const first = pattern.exec(html);
  return first ? (first[1] as string) : null;
}

/** Build the RSC endpoint URL recorded in snapshot source metadata. */
export function buildRscEndpoint(startUrl: string, rscParam: string | null): string {
  if (!rscParam) return startUrl;
  const url = new URL(startUrl);
  url.searchParams.set("_rsc", rscParam);
  return url.toString();
}

/** One parsed Flight row. */
export interface FlightRow {
  rowId: string;
  value: unknown;
}

/**
 * Parse the concatenated flight stream into rows. Rows whose value is not
 * JSON (text chunks, module references) are skipped; this is expected and not
 * an error. Returns only rows that carry a JSON value.
 */
export function parseFlightRows(flightText: string): FlightRow[] {
  const rows: FlightRow[] = [];
  for (const line of flightText.split("\n")) {
    const trimmed = line.trim();
    const separator = trimmed.indexOf(":");
    if (separator <= 0) continue;
    const rowId = trimmed.slice(0, separator);
    const rest = trimmed.slice(separator + 1);
    if (!/^[0-9a-f]+$/.test(rowId)) continue;
    if (!rest.startsWith("{") && !rest.startsWith("[")) continue;
    try {
      rows.push({ rowId, value: JSON.parse(rest) });
    } catch {
      // Unparseable JSON row: skip rather than fail; completeness is enforced
      // by requiring at least one valid model below.
    }
  }
  return rows;
}

/** A raw model-shaped object found in a Flight payload. */
export type RawAaModel = Record<string, unknown>;

/**
 * Recursively walk parsed Flight values collecting every model-shaped object:
 * an object with a string `slug` and a non-null object
 * `canonicalIntelligenceIndexTokenCount` — the marker AA publishes only on
 * models with a measured Intelligence Index run.
 */
export function collectRawModels(value: unknown, out: RawAaModel[] = []): RawAaModel[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRawModels(item, out);
    return out;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const counts = record["canonicalIntelligenceIndexTokenCount"];
    if (typeof record["slug"] === "string" && counts !== null && typeof counts === "object") {
      out.push(record);
    }
    for (const child of Object.values(record)) collectRawModels(child, out);
  }
  return out;
}
