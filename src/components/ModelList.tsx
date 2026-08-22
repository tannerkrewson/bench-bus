import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { modelGroupColor } from "../charts/brand";
import { modelGroupKey } from "../charts/modelMetadata";
import { modelVariantParts } from "../charts/labelLayout";
import { isDarkTheme } from "./ThemeToggle";
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
  /** Current pricing-specific badge text for unplottable rows. */
  unplottableLabel?: () => string;
  /** Current pricing-specific explanation for unplottable rows. */
  unplottableDescription?: () => string;
}

/**
 * Accessible model visibility menu. Search is deliberately inside the menu so
 * there is one visibility affordance instead of a separate graph filter.
 */
type ModelListItem = {
  key: string;
  label: string;
  /** Keep a stable concise spelling for accessible checkbox names. */
  selectionLabel?: string;
  members: readonly PlottablePoint[];
  searchText: string;
  colorKey?: string;
};

const EFFORT_ORDER: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  xhigh: 3,
  max: 4,
};

/**
 * Build selector rows without changing the underlying model ids. A family row
 * is only created when at least two effort variants are present, so ordinary
 * models retain their familiar individual row in combined mode.
 */
function modelItems(points: readonly PlottablePoint[]): ModelListItem[] {
  const sorted = [...points].sort((a, b) => a.label.localeCompare(b.label));
  const groups = new Map<string, { label: string; members: PlottablePoint[]; colorKey: string }>();
  const individual: ModelListItem[] = [];

  for (const point of sorted) {
    const parts = modelVariantParts(point.label);
    // An effortGroup is also assigned to ordinary base models by adapters, so
    // it cannot by itself make a selector family. Only labels with an explicit
    // reasoning-effort suffix participate in combined rows.
    if (!parts) {
      individual.push({
        key: `model:${point.id}`,
        label: point.label,
        selectionLabel: point.selectionLabel,
        members: [point],
        searchText: `${point.label} ${point.selectionLabel ?? ""} ${point.id}`,
      });
      continue;
    }
    const colorKey = point.effortGroup ?? modelGroupKey(parts.baseLabel, point.id);
    const group = groups.get(colorKey) ?? {
      label: parts.baseLabel,
      members: [],
      colorKey,
    };
    group.members.push(point);
    groups.set(colorKey, group);
  }

  for (const [key, group] of groups) {
    if (group.members.length === 1) {
      const point = group.members[0]!;
      individual.push({
        key: `model:${point.id}`,
        label: point.label,
        selectionLabel: point.selectionLabel,
        members: [point],
        searchText: `${point.label} ${point.selectionLabel ?? ""} ${point.id}`,
      });
      continue;
    }
    const members = [...group.members].sort(
      (a, b) =>
        (EFFORT_ORDER[modelVariantParts(a.label)?.effort ?? ""] ?? 99) -
          (EFFORT_ORDER[modelVariantParts(b.label)?.effort ?? ""] ?? 99) ||
        a.label.localeCompare(b.label),
    );
    individual.push({
      key: `family:${key}`,
      label: group.label,
      members,
      colorKey: group.colorKey,
      // Include every variant in the haystack so searching “High” still
      // reveals the collapsed family row labelled “Opus 5”.
      searchText: [group.label, ...members.flatMap((point) => [point.label, point.id])].join(" "),
    });
  }

  return individual.sort((a, b) => a.label.localeCompare(b.label));
}

export default function ModelList(props: ModelListProps) {
  let details: HTMLDetailsElement | undefined;
  let summary: HTMLElement | undefined;
  const [open, setOpen] = createSignal(false);
  const [combinedMode, setCombinedMode] = createSignal(true);
  const [localQuery, setLocalQuery] = createSignal("");
  const [darkTheme, setDarkTheme] = createSignal(false);
  let modelMenu: HTMLDivElement | undefined;
  const query = () => props.query?.() ?? localQuery();
  const setQuery = (value: string) => {
    if (props.onQueryChange) props.onQueryChange(value);
    else setLocalQuery(value);
  };
  const sorted = createMemo(() => [...props.points()].sort((a, b) => a.label.localeCompare(b.label)));
  const items = createMemo(() => modelItems(sorted()));
  const familyColorById = createMemo(() =>
    new Map(
      items()
        .filter((item) => item.members.length > 1 && item.colorKey)
        .flatMap((item) => item.members.map((point) => [point.id, item.colorKey!] as const)),
    ),
  );
  const displayItems = createMemo(() => {
    if (combinedMode()) return items();
    return sorted().map((point) => ({
      key: `model:${point.id}`,
      label: point.label,
      selectionLabel: point.selectionLabel,
      members: [point],
      searchText: `${point.label} ${point.selectionLabel ?? ""} ${point.id}`,
      colorKey: familyColorById().get(point.id),
    }));
  });
  const unplottableSorted = createMemo(() =>
    [...props.unplottable()].sort((a, b) => a.label.localeCompare(b.label)),
  );
  const filtered = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase();
    return needle === "" ? displayItems() : displayItems().filter((item) =>
      item.searchText.toLocaleLowerCase().includes(needle),
    );
  });
  const filteredUnplottable = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase();
    return needle === ""
      ? unplottableSorted()
      : unplottableSorted().filter((item) => `${item.label} ${item.id}`.toLocaleLowerCase().includes(needle));
  });
  const unplottableLabel = () => props.unplottableLabel?.() ?? "no pricing";
  const unplottableDescription = () =>
    props.unplottableDescription?.() ?? "Unavailable with the current pricing settings.";
  const visibleSelectedCount = createMemo(() =>
    filtered().filter((item) => item.members.every((point) => props.selectedIds().includes(point.id))).length,
  );

  const close = () => {
    setOpen(false);
    if (details) details.open = false;
  };
  onMount(() => {
    setDarkTheme(isDarkTheme(document.documentElement.dataset.theme));
    const onThemeChange = () => setDarkTheme(isDarkTheme(document.documentElement.dataset.theme));
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
    window.addEventListener("bench-bus-theme-change", onThemeChange);
    onCleanup(() => {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onDocumentKeyDown);
      window.removeEventListener("bench-bus-theme-change", onThemeChange);
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
  const toggleCombinedMode = () => {
    const scrollTop = modelMenu?.scrollTop ?? 0;
    setCombinedMode((value) => !value);
    if (modelMenu) modelMenu.scrollTop = scrollTop;
    queueMicrotask(() => {
      if (modelMenu) modelMenu.scrollTop = scrollTop;
    });
  };
  const toggleItem = (item: ModelListItem) => {
    const selected = new Set(props.selectedIds());
    const allSelected = item.members.every((point) => selected.has(point.id));
    // Add only missing members or remove only selected members. This keeps a
    // partially selected family deterministic and preserves unrelated URL/user
    // selections exactly as they were.
    for (const point of item.members) {
      if (selected.has(point.id) === allSelected) props.onToggleSelect(point.id);
    }
  };
  const itemColor = (item: ModelListItem) => {
    const point = item.members[0]!;
    return modelGroupColor(
      item.colorKey ?? point.effortGroup ?? modelGroupKey(point.label, point.id),
      darkTheme(),
    );
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
        aria-expanded={open()}
      >
        <span class="flex items-center gap-2">
          <span>Models</span>
          <span class="badge badge-sm">{displayItems().length}</span>
        </span>
        <span class="text-xs text-base-content/60">
          {visibleSelectedCount()} of {combinedMode() ? items().length : sorted().length} visible
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
        <div class="mb-2 flex items-center justify-between gap-3 rounded-box border border-base-300 px-2 py-1.5" data-testid="model-effort-mode">
          <span>
            <span class="block text-sm font-medium">Effort selection</span>
            <span class="block text-xs text-base-content/60">
              {combinedMode() ? "Combined model-family variants" : "Individual effort variants"}
            </span>
          </span>
          <button
            id={`${props.searchId ?? "model-list-search"}-effort-mode`}
            type="button"
            role="switch"
            class="btn btn-outline btn-xs min-w-20 shrink-0"
            aria-checked={combinedMode()}
            aria-label="Combine model-family effort variants"
            onClick={toggleCombinedMode}
          >
            {combinedMode() ? "Combined" : "Individual"}
          </button>
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
        <div
          ref={modelMenu}
          class="menu menu-sm max-h-96 w-full flex-nowrap overscroll-contain overflow-x-hidden overflow-y-auto p-0"
          role="group"
          aria-label="Model visibility"
        >
          <For each={filtered()}>
            {(item) => {
              const selected = () => new Set(props.selectedIds());
              const selectedCount = () => item.members.filter((point) => selected().has(point.id)).length;
              const allSelected = () => selectedCount() === item.members.length;
              const partiallySelected = () => selectedCount() > 0 && !allSelected();
              return (
                <label class="label min-h-9 w-full max-w-full cursor-pointer justify-between gap-3 rounded-box px-2 py-1 hover:bg-base-200">
                  <span class="flex min-w-0 flex-1 items-start gap-2">
                    <span
                      class="mt-1 h-3 w-3 shrink-0 rounded-full border border-base-content/30"
                      style={{ "background-color": itemColor(item) }}
                      aria-hidden="true"
                    />
                    <span class="min-w-0 whitespace-normal break-words" title={item.label}>{item.label}</span>
                  </span>
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm checkbox-primary shrink-0"
                    ref={(element) => {
                      createEffect(() => {
                        element.indeterminate = partiallySelected();
                      });
                    }}
                    checked={allSelected()}
                    aria-checked={partiallySelected() ? "mixed" : allSelected() ? "true" : "false"}
                    aria-label={`Show ${item.selectionLabel ?? item.label}`}
                    onChange={() => toggleItem(item)}
                  />
                </label>
              );
            }}
          </For>
          <Show when={filteredUnplottable().length > 0}>
            <p class="px-2 pb-1 pt-2 text-xs text-base-content/60" role="note">
              {unplottableDescription()}
            </p>
          </Show>
          <For each={filteredUnplottable()}>
            {(item) => (
              <div class="label min-h-9 w-full max-w-full cursor-not-allowed justify-between gap-3 px-2 py-1 text-base-content/50">
                <span class="flex min-w-0 flex-1 items-start gap-2">
                  <span
                    class="mt-1 h-3 w-3 shrink-0 rounded-full border border-base-content/30"
                    style={{ "background-color": modelGroupColor(modelGroupKey(item.label, item.id), darkTheme()) }}
                    aria-hidden="true"
                  />
                  <span class="min-w-0 whitespace-normal break-words" title={item.label}>{item.label}</span>
                </span>
                <span class="badge badge-ghost badge-xs shrink-0" title={unplottableDescription()}>
                  {unplottableLabel()}
                </span>
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
