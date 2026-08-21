import { For, Show, createMemo } from "solid-js";
import type { PlottablePoint } from "../charts/types";

export interface ModelListProps {
  /** Points currently plotted (filter already applied). */
  points: () => readonly PlottablePoint[];
  selectedIds: () => readonly string[];
  onToggleSelect: (id: string) => void;
  /** Ids of unplottable (matched but unpriced) models, shown disabled. */
  unplottable: () => readonly { id: string; label: string }[];
}

/**
 * Compact model multi-select. The dropdown keeps the chart wide while
 * retaining an accessible checkbox for every plotted model.
 */
export default function ModelList(props: ModelListProps) {
  const sorted = createMemo(() => [...props.points()].sort((a, b) => a.label.localeCompare(b.label)));
  const unplottableSorted = createMemo(() =>
    [...props.unplottable()].sort((a, b) => a.label.localeCompare(b.label)),
  );
  const selectedCount = createMemo(() => props.selectedIds().length);
  const totalCount = createMemo(() => sorted().length);

  const clearSelection = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    for (const id of props.selectedIds()) props.onToggleSelect(id);
  };

  return (
    <details class="dropdown dropdown-end w-72 max-w-full" data-testid="model-list">
      <summary class="btn btn-outline w-full justify-between gap-3">
        <span class="flex items-center gap-2">
          <span>Models</span>
          <span class="badge badge-sm">{totalCount()}</span>
        </span>
        <span class="text-xs text-base-content/60">
          {selectedCount() > 0 ? `${selectedCount()} selected` : "Select to highlight"}
        </span>
      </summary>
      <div class="dropdown-content z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-box border border-base-300 bg-base-100 p-3 shadow-xl">
        <div class="mb-2 flex items-center justify-between gap-3">
          <div>
            <div class="font-semibold">Choose models</div>
            <div class="text-xs text-base-content/60">Selected models are highlighted on the chart.</div>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            disabled={selectedCount() === 0}
            onClick={clearSelection}
          >
            Clear
          </button>
        </div>
        <div class="menu menu-sm w-full max-h-96 overflow-y-auto p-0" role="group" aria-label="Model selection">
          <For each={sorted()}>
            {(point) => (
              <label class="label min-h-9 w-full max-w-full cursor-pointer justify-between gap-3 rounded-box px-2 py-1 hover:bg-base-200">
                <span class="min-w-0 flex-1 truncate" title={point.label}>{point.label}</span>
                <input
                  type="checkbox"
                  class="checkbox checkbox-sm checkbox-primary"
                  checked={props.selectedIds().includes(point.id)}
                  aria-label={`Select ${point.label}`}
                  onChange={() => props.onToggleSelect(point.id)}
                />
              </label>
            )}
          </For>
          <For each={unplottableSorted()}>
            {(item) => (
              <div class="label min-h-9 w-full max-w-full cursor-not-allowed justify-between gap-3 px-2 py-1 text-base-content/50">
                <span class="min-w-0 flex-1 truncate" title={item.label}>{item.label}</span>
                <span class="badge badge-ghost badge-xs">no pricing</span>
              </div>
            )}
          </For>
        </div>
        <Show when={sorted().length === 0 && unplottableSorted().length === 0}>
          <p class="py-4 text-sm text-base-content/60" role="status">
            No models match the current filter.
          </p>
        </Show>
      </div>
    </details>
  );
}
