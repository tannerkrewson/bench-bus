import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { PlottablePoint } from "../charts/types";

export interface ModelListProps {
  /** All points currently available under the active pricing settings. */
  points: () => readonly PlottablePoint[];
  selectedIds: () => readonly string[];
  onToggleSelect: (id: string) => void;
  /** IDs used by the benchmark's initial curated/default view. */
  defaultSelectedIds?: () => readonly string[];
  onResetDefault?: () => void;
  /** The query is owned by the benchmark section for URL persistence. */
  query?: () => string;
  onQueryChange?: (query: string) => void;
  /** Stable id suffix for the menu's internal search field. */
  searchId?: string;
  /** Ids of unplottable (matched but unpriced) models, shown disabled. */
  unplottable: () => readonly { id: string; label: string }[];
}

/**
 * Accessible model visibility menu. Search is deliberately inside the menu so
 * there is one visibility affordance instead of a separate graph filter.
 */
export default function ModelList(props: ModelListProps) {
  let details: HTMLDetailsElement | undefined;
  let summary: HTMLElement | undefined;
  const [open, setOpen] = createSignal(false);
  const [localQuery, setLocalQuery] = createSignal("");
  const query = () => props.query?.() ?? localQuery();
  const setQuery = (value: string) => {
    if (props.onQueryChange) props.onQueryChange(value);
    else setLocalQuery(value);
  };
  const sorted = createMemo(() => [...props.points()].sort((a, b) => a.label.localeCompare(b.label)));
  const unplottableSorted = createMemo(() =>
    [...props.unplottable()].sort((a, b) => a.label.localeCompare(b.label)),
  );
  const filtered = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase();
    return needle === "" ? sorted() : sorted().filter((point) =>
      `${point.label} ${point.id}`.toLocaleLowerCase().includes(needle),
    );
  });
  const filteredUnplottable = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase();
    return needle === ""
      ? unplottableSorted()
      : unplottableSorted().filter((item) => `${item.label} ${item.id}`.toLocaleLowerCase().includes(needle));
  });
  const visibleSelectedCount = createMemo(() =>
    filtered().filter((point) => props.selectedIds().includes(point.id)).length,
  );

  const close = () => {
    setOpen(false);
    if (details) details.open = false;
  };
  onMount(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (details && !details.contains(event.target as Node)) close();
    };
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open()) {
        event.preventDefault();
        close();
        summary?.focus();
      }
    };
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onDocumentKeyDown);
    onCleanup(() => {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onDocumentKeyDown);
    });
  });

  const clearSelection = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    // Snapshot before toggling: the first toggle can switch from the adapter's
    // implicit default selection to an explicit selection synchronously.
    const selectedIds = [...props.selectedIds()];
    for (const id of selectedIds) props.onToggleSelect(id);
  };
  const resetDefault = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onResetDefault?.();
  };

  return (
    <details
      ref={details}
      class="dropdown dropdown-end w-72 max-w-full"
      open={open()}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      data-testid="model-list"
    >
      <summary
        ref={summary}
        class="btn btn-outline btn-sm w-full justify-between gap-3"
        aria-haspopup="listbox"
        aria-expanded={open()}
      >
        <span class="flex items-center gap-2">
          <span>Models</span>
          <span class="badge badge-sm">{sorted().length}</span>
        </span>
        <span class="text-xs text-base-content/60">
          {visibleSelectedCount()} of {sorted().length} visible
        </span>
      </summary>
      <div class="dropdown-content z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-x-hidden rounded-box border border-base-300 bg-base-100 p-3 shadow-xl">
        <div class="mb-2 flex items-center justify-between gap-3">
          <div>
            <div class="font-semibold">Choose visible models</div>
            <div class="text-sm text-base-content/60">Select the models plotted on this chart.</div>
          </div>
          <div class="flex shrink-0 gap-1">
            <button type="button" class="btn btn-ghost btn-xs" onClick={clearSelection}>
              Clear
            </button>
            <button type="button" class="btn btn-ghost btn-xs" onClick={resetDefault}>
              Reset to default
            </button>
          </div>
        </div>
        <label class="mb-2 block" for={props.searchId ?? "model-list-search"}>
          <span class="sr-only">Filter models</span>
          <input
            id={props.searchId ?? "model-list-search"}
            type="search"
            class="input input-sm input-bordered w-full"
            placeholder="Filter models…"
            value={query()}
            aria-label="Filter models by name"
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <div class="menu menu-sm max-h-96 w-full overflow-x-hidden overflow-y-auto p-0" role="group" aria-label="Model visibility">
          <For each={filtered()}>
            {(point) => (
              <label class="label min-h-9 w-full max-w-full cursor-pointer justify-between gap-3 rounded-box px-2 py-1 hover:bg-base-200">
                <span class="min-w-0 flex-1 whitespace-normal break-all" title={point.label}>{point.label}</span>
                <input
                  type="checkbox"
                  class="checkbox checkbox-sm checkbox-primary"
                  checked={props.selectedIds().includes(point.id)}
                  aria-label={`Show ${point.label}`}
                  onChange={() => props.onToggleSelect(point.id)}
                />
              </label>
            )}
          </For>
          <For each={filteredUnplottable()}>
            {(item) => (
              <div class="label min-h-9 w-full max-w-full cursor-not-allowed justify-between gap-3 px-2 py-1 text-base-content/50">
                <span class="min-w-0 flex-1 whitespace-normal break-all" title={item.label}>{item.label}</span>
                <span class="badge badge-ghost badge-xs">no pricing</span>
              </div>
            )}
          </For>
        </div>
        <Show when={filtered().length === 0 && filteredUnplottable().length === 0}>
          <p class="py-4 text-base-content/70" role="status">No models match this filter.</p>
        </Show>
      </div>
    </details>
  );
}
