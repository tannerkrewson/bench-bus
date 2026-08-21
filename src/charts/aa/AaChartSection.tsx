import { createEffect, createMemo, createSignal, Show } from "solid-js";
import BenchmarkScatterChart from "../BenchmarkScatterChart";
import ChartTooltip from "../ChartTooltip";
import { buildChartPlot } from "../plotData";
import type {
  ChartViewState,
  PricingControlState,
  TooltipLine,
} from "../types";
import ChartControlPanel from "../../components/ChartControlPanel";
import ModelList from "../../components/ModelList";
import type { DerivedAaChartRecord } from "../../schemas";
import { aaAdapter, aaControlledTooltipLines } from "./adapter";

export interface AaChartSectionProps {
  records: () => readonly DerivedAaChartRecord[];
  /** Optional initial state, typically parsed from the current URL. */
  initialState?: Partial<ChartViewState>;
  /** Called on every interaction-state change for URL persistence. */
  onStateChange?: (state: Readonly<ChartViewState>) => void;
}

/**
 * Artificial Analysis chart section: Intelligence Index versus estimated
 * canonical-workload cost, with the three pricing modes and cache-hit
 * slider. Composes the shared chart primitives directly so hover tooltips
 * can include control-dependent rows (pricing mode, winning provider).
 */
export default function AaChartSection(props: AaChartSectionProps) {
  const defaultControls = (): PricingControlState =>
    Object.fromEntries(aaAdapter.controlSpecs.map((spec) => [spec.id, spec.default]));

  const [scale, setScale] = createSignal(props.initialState?.scale ?? aaAdapter.defaultXScale);
  const [query, setQuery] = createSignal(props.initialState?.query ?? "");
  const [selectedIds, setSelectedIds] = createSignal<string[]>(
    props.initialState?.selectedIds ?? [],
  );
  const [showLabels, setShowLabels] = createSignal(props.initialState?.showLabels ?? true);
  const [controls, setControls] = createSignal<PricingControlState>({
    ...defaultControls(),
    ...props.initialState?.controls,
  });

  const [hovered, setHovered] = createSignal<{
    id: string;
    left: number;
    top: number;
  } | null>(null);

  const build = createMemo(() =>
    buildChartPlot(props.records(), aaAdapter, controls(), query()),
  );

  const selectedId = createMemo<string | null>(() => {
    const ids = selectedIds();
    return ids.length > 0 ? (ids[ids.length - 1] as string) : null;
  });

  const hoveredInfo = createMemo<{ title: string; lines: readonly TooltipLine[] } | null>(() => {
    const h = hovered();
    if (!h) return null;
    const entry = build().entries.find((e) => e.point.id === h.id);
    if (!entry) return null;
    return {
      title: entry.point.label,
      lines: aaControlledTooltipLines(entry.record, entry.point, controls()),
    };
  });

  const emitState = () => {
    props.onStateChange?.({
      scale: scale(),
      query: query(),
      selectedIds: selectedIds(),
      controls: controls(),
      showLabels: showLabels(),
    });
  };
  createEffect(emitState);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const setControl = (id: string, value: number | boolean | string) => {
    setControls((prev) => ({ ...prev, [id]: value }));
  };

  return (
    <section
      class="card bg-base-100 border-base-300 border shadow-sm"
      data-benchmark={aaAdapter.benchmarkId}
      aria-label="Artificial Analysis Intelligence Index versus estimated benchmark cost"
    >
      <div class="card-body">
        <h2 class="card-title text-2xl">Artificial Analysis — Intelligence Index vs. cost</h2>
        <ChartControlPanel
          scale={scale}
          onScaleChange={setScale}
          query={query}
          onQueryChange={setQuery}
          specs={aaAdapter.controlSpecs}
          controls={controls}
          onControlChange={setControl}
          showLabels={showLabels}
          onShowLabelsChange={setShowLabels}
          isControlVisible={(spec) =>
            spec.id !== "cacheHitRate" || controls().pricingMode === "listed"
          }
        />

        <Show
          when={props.records().length > 0}
          fallback={
            <p class="rounded-box bg-base-200 p-8 text-center" role="status" data-testid="aa-empty">
              No Artificial Analysis data available yet. Snapshots are collected automatically;
              check back soon.
            </p>
          }
        >
          <div class="grid gap-4 lg:grid-cols-[1fr_14rem]">
            <div class="relative">
              <Show
                when={build().entries.length > 0}
                fallback={
                  <p
                    class="rounded-box bg-base-200 p-8 text-center"
                    role="status"
                    data-testid="aa-no-points"
                  >
                    No models have computable costs for the current pricing settings.
                  </p>
                }
              >
                <BenchmarkScatterChart
                  points={() => build().entries.map((e) => e.point)}
                  scale={scale}
                  selectedId={selectedId}
                  showLabels={showLabels}
                  xAxisLabel={() => aaAdapter.xAxisLabel}
                  yAxisLabel={() => aaAdapter.yAxisLabel}
                  onHover={(id, pos) =>
                    setHovered(id && pos ? { id, left: pos.left, top: pos.top } : null)
                  }
                  onActivate={toggleSelect}
                />
              </Show>
              <ChartTooltip
                left={() => hovered()?.left ?? 0}
                top={() => hovered()?.top ?? 0}
                title={() => hoveredInfo()?.title ?? null}
                lines={() => hoveredInfo()?.lines ?? []}
              />
            </div>
            <ModelList
              points={() => build().entries.map((e) => e.point)}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              unplottable={() => build().unplottable.map((u) => aaAdapter.identity(u.record))}
            />
          </div>
          <Show when={build().unplottable.length > 0}>
            <p class="text-xs text-base-content/60" role="status" data-testid="aa-unplottable-count">
              {build().unplottable.length} model(s) shown in the list but not plotted: no usable
              pricing for the current mode — never estimated as $0.
            </p>
          </Show>
          <Show when={build().filteredOut > 0}>
            <p class="text-xs text-base-content/60" role="status" data-testid="aa-filter-count">
              {build().filteredOut} model(s) hidden by the current filter.
            </p>
          </Show>
        </Show>

        <p class="mt-2 text-xs text-base-content/60">{aaAdapter.disclaimer}</p>
      </div>
    </section>
  );
}
