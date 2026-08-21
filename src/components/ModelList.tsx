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
 * Keyboard-accessible model list doubling as the chart's accessible
 * alternative: every plotted point has a real button here.
 */
export default function ModelList(props: ModelListProps) {
  const sorted = createMemo(() => [...props.points()].sort((a, b) => a.label.localeCompare(b.label)));
  const unplottableSorted = createMemo(() =>
    [...props.unplottable()].sort((a, b) => a.label.localeCompare(b.label)),
  );

  return (
    <div data-testid="model-list">
      <div class="mb-1 text-sm font-medium">Models</div>
      <ul class="menu w-56 bg-base-200 rounded-box max-h-72 overflow-y-auto p-1">
        <For each={sorted()}>
          {(point) => (
            <li>
              <button
                type="button"
                classList={{ "menu-active": props.selectedIds().includes(point.id) }}
                aria-pressed={props.selectedIds().includes(point.id)}
                onClick={() => props.onToggleSelect(point.id)}
              >
                {point.label}
              </button>
            </li>
          )}
        </For>
        <For each={unplottableSorted()}>
          {(item) => (
            <li>
              <span class="text-base-content/50" title="No computable cost for the current pricing mode">
                {item.label} (no pricing)
              </span>
            </li>
          )}
        </For>
      </ul>
      <Show when={sorted().length === 0 && unplottableSorted().length === 0}>
        <p class="text-sm text-base-content/60" role="status">
          No models match the current filter.
        </p>
      </Show>
    </div>
  );
}
