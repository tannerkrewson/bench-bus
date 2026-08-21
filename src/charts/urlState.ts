import type {
  ChartViewState,
  PricingControlSpec,
  PricingControlState,
  PricingControlValue,
  XScale,
} from "./types";

/**
 * URL (de)serialization for benchmark chart interaction state.
 *
 * Keys are namespaced per benchmark so two charts can coexist on one page:
 *   chart.<benchmarkId>.scale        = log|linear
 *   chart.<benchmarkId>.q            = search query
 *   chart.<benchmarkId>.sel          = comma-separated selected ids
 *   chart.<benchmarkId>.labels       = false when model labels are hidden
 *   chart.<benchmarkId>.c.<control>  = control value (string form)
 *
 * Parsing is forgiving: unknown or invalid values fall back to defaults
 * instead of breaking the page on a stale or hand-edited URL.
 */

const SCALE_KEY = "scale";
const QUERY_KEY = "q";
const SELECTED_KEY = "sel";
const LABELS_KEY = "labels";
const CONTROL_PREFIX = "c.";

function key(benchmarkId: string, field: string): string {
  return `chart.${benchmarkId}.${field}`;
}

/** Serialize view state into a fresh URLSearchParams object. */
export function chartStateToParams(
  state: Readonly<ChartViewState>,
  benchmarkId: string,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set(key(benchmarkId, SCALE_KEY), state.scale);
  if (state.query !== "") params.set(key(benchmarkId, QUERY_KEY), state.query);
  // An explicitly empty selection is meaningful (the user cleared every
  // model), while an absent selection delegates to the benchmark default.
  if (state.selectionSpecified === true || state.selectedIds.length > 0) {
    params.set(key(benchmarkId, SELECTED_KEY), state.selectedIds.join(","));
  }
  if (state.showLabels === false) {
    params.set(key(benchmarkId, LABELS_KEY), "false");
  }
  for (const [id, value] of Object.entries(state.controls)) {
    params.set(key(benchmarkId, CONTROL_PREFIX + id), String(value));
  }
  return params;
}

/** Merge serialized chart state into an existing URLSearchParams object. */
export function mergeChartStateIntoParams(
  target: URLSearchParams,
  state: Readonly<ChartViewState>,
  benchmarkId: string,
): URLSearchParams {
  const own = chartStateToParams(state, benchmarkId);
  for (const [k, v] of own) target.set(k, v);
  return target;
}

function parseControlValue(raw: string, spec: PricingControlSpec): PricingControlValue | null {
  switch (spec.kind) {
    case "toggle":
      if (raw === "true") return true;
      if (raw === "false") return false;
      return null;
    case "slider": {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < spec.min || n > spec.max) return null;
      return n;
    }
    case "select":
      return spec.options.some((o) => o.value === raw) ? raw : null;
  }
}

export interface ChartStateDefaults {
  /** Defaults for controls not present (or invalid) in the params. */
  controls: Readonly<PricingControlState>;
  scale: XScale;
}

/**
 * Read view state from params. Missing/invalid entries fall back to the
 * provided defaults; unknown control ids in the URL are ignored.
 */
export function chartStateFromParams(
  params: Readonly<URLSearchParams>,
  benchmarkId: string,
  controlSpecs: readonly PricingControlSpec[],
  defaults: Readonly<ChartStateDefaults>,
): ChartViewState {
  const scaleRaw = params.get(key(benchmarkId, SCALE_KEY));
  const scale: XScale = scaleRaw === "linear" || scaleRaw === "log" ? scaleRaw : defaults.scale;

  const query = params.get(key(benchmarkId, QUERY_KEY)) ?? "";

  const selRaw = params.get(key(benchmarkId, SELECTED_KEY));
  const selectedIds = selRaw === null
    ? []
    : selRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
  // Keep the historical state shape for non-empty selections; only an
  // explicit empty value needs a discriminator because [] otherwise also
  // represents an omitted key.
  const selectionSpecified = selRaw !== null && selectedIds.length === 0;

  const labelsRaw = params.get(key(benchmarkId, LABELS_KEY));
  const showLabels =
    labelsRaw === "false" ? false : labelsRaw === "true" ? true : undefined;

  const controls: PricingControlState = { ...defaults.controls };
  for (const spec of controlSpecs) {
    const raw = params.get(key(benchmarkId, CONTROL_PREFIX + spec.id));
    if (raw === null) continue;
    const parsed = parseControlValue(raw, spec);
    if (parsed !== null) controls[spec.id] = parsed;
  }

  return {
    scale,
    query,
    selectedIds,
    controls,
    ...(selectionSpecified ? { selectionSpecified: true } : {}),
    ...(showLabels === undefined ? {} : { showLabels }),
  };
}

/** Convenience: full query-string serialization (no leading "?" ). */
export function chartStateToQueryString(
  state: Readonly<ChartViewState>,
  benchmarkId: string,
): string {
  return chartStateToParams(state, benchmarkId).toString();
}
