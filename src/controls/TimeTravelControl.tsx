import { For, Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { History } from "lucide-solid";
import { formatObservedLocal, formatObservedUtc } from "../history/resolve";
import { useTimeTravel } from "../history/TimeTravelContext";

/**
 * Shared point-in-time picker. A compact history icon keeps the current page
 * chrome quiet while the native details disclosure gives keyboard users an
 * obvious, focusable menu of compiled snapshots.
 */
export default function TimeTravelControl(): JSX.Element {
  const travel = useTimeTravel();
  const view = () => travel.view();
  const [open, setOpen] = createSignal(false);
  const availableTimes = () => [...view().availableTimes].reverse();
  const close = () => setOpen(false);

  const choose = (asOf: string | null) => {
    if (asOf === null) travel.returnToLatest();
    else travel.selectTime(asOf);
    close();
  };

  return (
    <div class="flex flex-wrap items-center gap-2" data-testid="time-travel-control">
      <details
        class="dropdown dropdown-end"
        open={open()}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary
          class="tooltip tooltip-bottom btn btn-sm btn-outline btn-square list-none"
          data-tip="Choose a benchmark snapshot from history"
          aria-label="Choose a benchmark snapshot from history"
          aria-haspopup="dialog"
          aria-expanded={open()}
          onClick={(event) => {
            // Keep Solid's signal and the native details element in sync in
            // jsdom and browsers that dispatch toggle after click.
            event.preventDefault();
            const next = !open();
            setOpen(next);
            (event.currentTarget.parentElement as HTMLDetailsElement).open = next;
          }}
        >
          <History size={17} aria-hidden="true" />
        </summary>
        <div
          class="dropdown-content z-20 mt-2 w-72 rounded-box border border-base-300 bg-base-100 p-3 shadow-xl"
          role="dialog"
          aria-label="Benchmark history"
          data-testid="time-travel-menu"
        >
          <h2 class="mb-2 text-sm font-semibold">Benchmark history</h2>
          <div
            class="flex max-h-96 flex-col gap-1 overflow-y-auto"
            role="menu"
            aria-label="Available benchmark snapshots"
          >
            <button
              type="button"
              class="btn btn-sm justify-start"
              classList={{ "btn-active": view().isLatest }}
              role="menuitem"
              onClick={() => choose(null)}
            >
              Latest data
            </button>
            <For each={availableTimes()}>
              {(asOf) => (
                <button
                  type="button"
                  class="btn btn-sm justify-start gap-2"
                  classList={{ "btn-active": view().entry?.asOf === asOf }}
                  title={`UTC: ${formatObservedUtc(asOf)}`}
                  role="menuitem"
                  onClick={() => choose(asOf)}
                >
                  <span>{formatObservedLocal(asOf)}</span>
                  <span class="text-xs font-normal text-base-content/60">
                    UTC: {formatObservedUtc(asOf)}
                  </span>
                </button>
              )}
            </For>
          </div>
          <Show when={!view().isLatest}>
            <button
              type="button"
              class="btn btn-ghost btn-sm mt-2 w-full"
              onClick={() => choose(null)}
            >
              Return to latest
            </button>
          </Show>
        </div>
      </details>
    </div>
  );
}

/** Pre-history status kept outside compact chrome such as the header navbar. */
export function TimeTravelNotice(): JSX.Element {
  const travel = useTimeTravel();
  return (
    <Show when={travel.view().preHistory}>
      <p class="mb-4 text-sm text-warning" role="status">
        The selected time predates Bench Bus's first collected snapshot — no older data exists.
        Pick a listed time or return to latest.
      </p>
    </Show>
  );
}
