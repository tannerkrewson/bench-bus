import type { JSX } from "solid-js";
import { createMemo, createSignal } from "solid-js";
import { resolveTimeTravel } from "./resolve";
import type { BundleIndex, TimeTravelState, TimeTravelView } from "./types";

/**
 * Shared point-in-time ("time travel") state for the whole page.
 *
 * The provider holds the selected historical time (null = latest), resolves
 * it against the compiled bundle index, and exposes the effective entry plus
 * per-selection metadata. Chart sections read the view through
 * {@link useTimeTravel} and load/decode the bundle for `view().entry`.
 *
 * URL persistence follows the same pattern as BenchmarkChartSection: the
 * provider reports state changes via `onStateChange`, and the host
 * (App) serializes them with `mergeTimeTravelStateIntoParams`.
 */

export interface TimeTravelProviderProps {
  /** Parsed contents of the derived output index.json. */
  index: BundleIndex | (() => BundleIndex);
  /** Initial selection (e.g. restored from the URL). Defaults to latest. */
  initialSelectedAsOf?: string | null;
  /** Called whenever the selection changes, for URL persistence. */
  onStateChange?: (state: Readonly<TimeTravelState>) => void;
  children: JSX.Element;
}

export interface TimeTravelContextValue {
  /** Current selection (null = latest). */
  selectedAsOf: () => string | null;
  /** Resolved view: effective entry, isLatest/preHistory flags, available times. */
  view: () => TimeTravelView;
  /** Select a compiled time (must be one of view().availableTimes). */
  selectTime: (asOf: string) => void;
  /** Return to the latest available data. */
  returnToLatest: () => void;
}

export function createTimeTravelValue(props: TimeTravelProviderProps): TimeTravelContextValue {
  const index = () => (typeof props.index === "function" ? props.index() : props.index);
  const [selectedAsOf, setSelectedAsOf] = createSignal<string | null>(
    props.initialSelectedAsOf ?? null,
  );
  const view = createMemo(() => resolveTimeTravel(index(), { selectedAsOf: selectedAsOf() }));

  const notify = (next: string | null) => {
    props.onStateChange?.({ selectedAsOf: next });
  };

  return {
    selectedAsOf,
    view,
    selectTime: (asOf: string) => {
      if (!availableHas(index(), asOf)) return;
      setSelectedAsOf(asOf);
      notify(asOf);
    },
    returnToLatest: () => {
      setSelectedAsOf(null);
      notify(null);
    },
  };
}

function availableHas(index: BundleIndex, asOf: string): boolean {
  return index.entries.some((e) => e.asOf === asOf);
}
