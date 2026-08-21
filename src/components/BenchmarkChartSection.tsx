import { createEffect, createMemo, createSignal, Show } from "solid-js";
import BenchmarkScatterChart from "../charts/BenchmarkScatterChart";
import ChartTooltip from "../charts/ChartTooltip";
import { buildChartPlot } from "../charts/plotData";
import type {
  BenchmarkChartAdapter,
  ChartViewState,
  PricingControlState,
  TooltipLine,
} from "../charts/types";
import ChartControlPanel from "./ChartControlPanel";
import ModelList from "./ModelList";

export interface BenchmarkChartSectionProps<TRecord> {
  adapter: BenchmarkChartAdapter<TRecord>;
  records: () => readonly TRecord[];
  /**
   * Optional initial state, typically parsed from the current URL by the
   * parent. Omitted fields fall back to adapter defaults.
   */
  initialState?: Partial<ChartViewState>;
  /**
   * Called whenever interaction state changes so the parent can persist it
   * (e.g. history.replaceState with chartStateToQueryString).
   */
  onStateChange?: (state: Readonly<ChartViewState>) => void;
}

/**
 * Full generic benchmark chart section: controls, uPlot scatter, hover
 * tooltip, model list, empty states, and the adapter's methodology note.
 * Benchmark specifics come exclusively from the adapter.
 */
export default function BenchmarkChartSection<TRecord>(props: BenchmarkChartSectionProps<TRecord>) {
  const defaultControls = (): PricingControlState =>
    Object.fromEntries(props.adapter.controlSpecs.map((spec) => [spec.id, spec.default]));

  const [scale, setScale] = createSignal(props.initialState?.scale ?? props.adapter.defaultXScale);
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

  const build = createMemo(() => buildChartPlot(props.records(), props.adapter, controls(), query()));

  const selectedId = createMemo<string | null>(() => null);
  const visibleEntries = createMemo(() => {
    const ids = selectedIds();
    return ids.length === 0 ? build().entries : build().entries.filter((entry) => ids.includes(entry.point.id));
  });

  const hoveredInfo = createMemo<{ title: string; lines: readonly TooltipLine[] } | null>(() => {
    const h = hovered();
    if (!h) return null;
    const entry = build().entries.find((e) => e.point.id === h.id);
    if (!entry) return null;
    const lines = [...props.adapter.tooltipLines(entry.record, entry.point)];
    if (entry.point.discount) {
      lines.push(
        { label: "Pre-discount cost", value: `$${entry.point.discount.preDiscountX.toFixed(2)}` },
        { label: "Effective discount", value: `${entry.point.discount.percentage}%${entry.point.discount.providerName ? ` (${entry.point.discount.providerName})` : ""}` },
      );
    }
    return { title: entry.point.label, lines };
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
      data-benchmark={props.adapter.benchmarkId}
    >
      <div class="card-body">
        <ChartControlPanel
          scale={scale}
          onScaleChange={setScale}
          query={query}
          onQueryChange={setQuery}
          specs={props.adapter.controlSpecs}
          controls={controls}
          onControlChange={setControl}
          showLabels={showLabels}
          onShowLabelsChange={setShowLabels}
        />

        <Show
          when={props.records().length > 0}
          fallback={
            <p
              class="rounded-box bg-base-200 p-8 text-center"
              role="status"
              data-testid="chart-empty"
            >
              No benchmark data available yet. Snapshots are collected automatically; check back
              soon.
            </p>
          }
        >
          <div class="mb-3 flex justify-end">
            <ModelList
              points={() => build().entries.map((e) => e.point)}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              unplottable={() =>
                build().unplottable.map((u) => props.adapter.identity(u.record))
              }
            />
          </div>
          <div class="relative">
            <Show
              when={visibleEntries().length > 0}
              fallback={
                <p
                  class="rounded-box bg-base-200 p-8 text-center"
                  role="status"
                  data-testid="chart-no-points"
                >
                  No models have computable costs for the current pricing settings.
                </p>
              }
            >
              <BenchmarkScatterChart
                points={() => visibleEntries().map((e) => e.point)}
                scale={scale}
                selectedId={selectedId}
                showLabels={showLabels}
                xAxisLabel={() => props.adapter.xAxisLabel}
                yAxisLabel={() => props.adapter.yAxisLabel}
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
          <Show when={build().filteredOut > 0}>
            <p class="text-xs text-base-content/60" role="status" data-testid="filter-count">
              {build().filteredOut} model(s) hidden by the current filter.
            </p>
          </Show>
        </Show>

        <Show when={props.adapter.disclaimer}>
          <p class="mt-2 text-xs text-base-content/60">{props.adapter.disclaimer}</p>
        </Show>
      </div>
    </section>
  );
}
