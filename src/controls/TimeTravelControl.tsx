import { For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { formatObservedUtc } from "../history/resolve";
import { useTimeTravel } from "../history/TimeTravelContext";

/**
 * Shared point-in-time selector: move from latest data to earlier collected
 * states and back. Options come from the compiled bundle index, so every
 * selectable time is known-available; selections that predate collected
 * history (e.g. a hand-edited URL) surface an explicit notice with a
 * one-click return to latest rather than implying older data exists.
 *
 * Keyboard accessible by construction: a native <select> plus a <button>.
 */
export default function TimeTravelControl(): JSX.Element {
  const travel = useTimeTravel();
  const view = () => travel.view();

  return (
    <div class="flex flex-wrap items-center gap-2" data-testid="time-travel-control">
      <label class="text-sm font-medium" for="time-travel-select">
        View data as of
      </label>
      <select
        id="time-travel-select"
        class="select select-bordered select-sm"
        // "Latest data" stays selected while viewing the newest time; an
        // explicit historical selection shows its own compiled time.
        value={view().isLatest ? "" : (view().entry?.asOf ?? "")}
        onChange={(e) => {
          const value = e.currentTarget.value;
          if (value === "") travel.returnToLatest();
          else travel.selectTime(value);
        }}
      >
        <option value="">Latest data</option>
        <For each={[...view().availableTimes].reverse()}>
          {(asOf) => <option value={asOf}>{formatObservedUtc(asOf)}</option>}
        </For>
      </select>
      <button
        type="button"
        class="btn btn-sm"
        disabled={view().isLatest}
        onClick={() => travel.returnToLatest()}
      >
        Back to latest
      </button>
      <Show when={view().preHistory}>
        <p class="text-sm text-warning" role="status">
          The selected time predates Bench Bus's first collected snapshot — no older data exists.
          Pick a listed time or return to latest.
        </p>
      </Show>
    </div>
  );
}
