import type { TimeTravelState } from "./types";

/**
 * URL (de)serialization for historical time-travel state.
 *
 * Follows the src/charts/urlState.ts conventions: a single namespaced key,
 * omitted when at the default, and forgiving parsing (invalid values fall
 * back to the default instead of breaking the page).
 *
 *   history.t = ISO UTC selected time (omitted = latest available data)
 */

const TIME_KEY = "history.t";

/** ISO-8601 UTC shape check (Date.parse alone accepts sloppy input). */
function isIsoUtc(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** Serialize time-travel state into a fresh URLSearchParams object. */
export function timeTravelStateToParams(state: Readonly<TimeTravelState>): URLSearchParams {
  const params = new URLSearchParams();
  if (state.selectedAsOf !== null) params.set(TIME_KEY, state.selectedAsOf);
  return params;
}

/**
 * Merge serialized time-travel state into an existing URLSearchParams object.
 * Latest state removes the key, so merging can both set and clear the
 * selection without disturbing other params.
 */
export function mergeTimeTravelStateIntoParams(
  target: URLSearchParams,
  state: Readonly<TimeTravelState>,
): URLSearchParams {
  if (state.selectedAsOf === null) {
    target.delete(TIME_KEY);
    return target;
  }
  target.set(TIME_KEY, state.selectedAsOf);
  return target;
}

/**
 * Read time-travel state from params. Missing or invalid values fall back to
 * `null` (latest available data) instead of breaking the page on a stale or
 * hand-edited URL.
 */
export function timeTravelStateFromParams(params: Readonly<URLSearchParams>): TimeTravelState {
  const raw = params.get(TIME_KEY);
  if (raw === null || raw === "" || !isIsoUtc(raw)) {
    return { selectedAsOf: null };
  }
  return { selectedAsOf: raw };
}
