import { createEffect, createMemo, createSignal, Show } from "solid-js";
import BenchmarkScatterChart from "../charts/BenchmarkScatterChart";
import ChartTooltip from "../charts/ChartTooltip";
import ChartWatermark from "./ChartWatermark";
import {
  buildChartPlot,
  discountProviderRole,
  largestExplicitDiscountForPoint,
} from "../charts/plotData";
import type {
  BenchmarkChartAdapter,
  ChartViewState,
  PricingControlSpec,
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
  /** Optional visibility predicate for controls that depend on another control. */
  isControlVisible?: (
    spec: PricingControlSpec,
    controls: Readonly<PricingControlState>,
  ) => boolean;
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
  const [selectedIds, setSelectedIds] = createSignal<string[]>(props.initialState?.selectedIds ?? []);
  const [selectionSpecified, setSelectionSpecified] = createSignal(
    props.initialState?.selectionSpecified ?? (props.initialState?.selectedIds?.length ?? 0) > 0,
  );
  const [showLabels, setShowLabels] = createSignal(props.initialState?.showLabels ?? true);
  const [showFrontier, setShowFrontier] = createSignal(props.initialState?.showFrontier ?? false);
  const [showDiscounts, setShowDiscounts] = createSignal(props.initialState?.showDiscounts ?? true);
  const [controls, setControls] = createSignal<PricingControlState>({
    ...defaultControls(),
    ...props.initialState?.controls,
  });

  const build = createMemo(() => buildChartPlot(props.records(), props.adapter, controls(), ""));
  const defaultSelectionIds = createMemo(() => {
    const entries = build().entries;
    const points = entries.map((entry) => entry.point);
    return props.adapter.defaultSelectionIds?.(props.records(), points) ?? points.map((point) => point.id);
  });

  const [hovered, setHovered] = createSignal<{
    id: string;
    left: number;
    top: number;
  } | null>(null);

  const effectiveSelectedIds = createMemo(() =>
    selectionSpecified() ? selectedIds() : defaultSelectionIds(),
  );
  const visibleEntries = createMemo(() => {
    const ids = new Set(effectiveSelectedIds());
    return build().entries.filter((entry) => ids.has(entry.point.id));
  });

  const hoveredInfo = createMemo<{ title: string; lines: readonly TooltipLine[] } | null>(() => {
    const h = hovered();
    if (!h) return null;
    const entry = build().entries.find((e) => e.point.id === h.id);
    if (!entry) return null;
    const lines = [...props.adapter.tooltipLines(entry.record, entry.point, controls())];
    const discount = showDiscounts() ? largestExplicitDiscountForPoint(entry.point) : null;
    if (discount) {
      const role = discountProviderRole(entry.point, discount);
      lines.push(
        {
          label: "Discount provider",
          value: `${discount.providerName ?? "Source provider"} (${role === "plotted" ? "plotted provider" : "alternative provider"})`,
        },
        { label: "Pre-discount cost", value: `$${discount.preDiscountX.toFixed(2)}` },
        {
          label: "Discounted provider cost",
          value: `$${(discount.effectiveX ?? entry.point.x).toFixed(2)}`,
        },
        { label: "Discount", value: `${discount.percentage}% off` },
      );
    }
    return { title: entry.point.label, lines };
  });

  const emitState = () => {
    props.onStateChange?.({
      scale: scale(),
      query: query(),
      selectedIds: selectedIds(),
      ...(selectionSpecified() ? { selectionSpecified: true } : {}),
      controls: controls(),
      showLabels: showLabels(),
      showFrontier: showFrontier(),
      showDiscounts: showDiscounts(),
    });
  };
  createEffect(emitState);

  const toggleSelect = (id: string) => {
    // Capture both values before changing selectionSpecified: Solid applies
    // signal writes synchronously, so reading it inside the updater would make
    // the first toggle discard the adapter's default selection.
    const wasSelectionSpecified = selectionSpecified();
    const current = effectiveSelectedIds();
    setSelectionSpecified(true);
    setSelectedIds((prev) => {
      const source = wasSelectionSpecified ? prev : current;
      return source.includes(id) ? source.filter((x) => x !== id) : [...source, id];
    });
  };

  const resetDefault = () => {
    setSelectionSpecified(false);
    setSelectedIds([]);
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
        <header class="mb-1">
          <h2 class="card-title text-2xl">{props.adapter.title}</h2>
          <p class="mt-1 text-sm text-base-content/70">{props.adapter.subtitle}</p>
        </header>
        <ChartControlPanel
          scale={scale}
          onScaleChange={setScale}
          benchmarkId={props.adapter.benchmarkId}
          specs={props.adapter.controlSpecs}
          controls={controls}
          onControlChange={setControl}
          isControlVisible={(spec) => props.isControlVisible?.(spec, controls()) ?? true}
          showLabels={showLabels}
          onShowLabelsChange={setShowLabels}
          showFrontier={showFrontier}
          onShowFrontierChange={setShowFrontier}
          showDiscounts={showDiscounts}
          onShowDiscountsChange={setShowDiscounts}
        />

        <Show when={props.records().length > 0}>
          <div class="mb-3 flex justify-end">
            <ModelList
              points={() => build().entries.map((e) => e.point)}
              selectedIds={effectiveSelectedIds}
              defaultSelectedIds={defaultSelectionIds}
              searchId={`chart-${props.adapter.benchmarkId}-model-search`}
              onResetDefault={resetDefault}
              query={query}
              onQueryChange={setQuery}
              onToggleSelect={toggleSelect}
              unplottableLabel={() => props.adapter.unplottableLabel?.(controls()) ?? "no pricing"}
              unplottableDescription={() =>
                props.adapter.unplottableDescription?.(controls()) ??
                "Unavailable with the current pricing settings."
              }
              unplottable={() =>
                build().unplottable.map((u) => props.adapter.identity(u.record))
              }
            />
          </div>
        </Show>
        <div class="relative min-h-[560px] sm:min-h-[740px]" data-testid="chart-area">
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
              {/* Keep the plot readable on portrait screens. The scroll viewport
                  is intentionally narrower than this minimum plot width; at
                  sm and above the chart returns to its normal fluid width. */}
              <div class="w-full overflow-x-auto overscroll-x-contain" data-testid="chart-scroll">
                <div class="relative min-w-[720px] sm:min-w-0" data-testid="chart-scroll-content">
                  <BenchmarkScatterChart
                    points={() => visibleEntries().map((e) => e.point)}
                    scale={scale}
                    showLabels={showLabels}
                    showFrontier={showFrontier}
                    showDiscounts={showDiscounts}
                    xAxisLabel={() => props.adapter.xAxisLabel}
                    yAxisLabel={() => props.adapter.yAxisLabel}
                    onHover={(id, pos) =>
                      setHovered(id && pos ? { id, left: pos.left, top: pos.top } : null)
                    }
                  />
                  <ChartTooltip
                    left={() => hovered()?.left ?? 0}
                    top={() => hovered()?.top ?? 0}
                    title={() => hoveredInfo()?.title ?? null}
                    lines={() => hoveredInfo()?.lines ?? []}
                  />
                </div>
              </div>
              <ChartWatermark />
            </Show>
            <Show when={showFrontier()}>
              <div class="mt-2 flex items-center justify-center gap-2 text-sm text-base-content/70" role="img" aria-label="Pareto frontier (dotted line)">
                <span class="w-6 border-t-2 border-dashed border-primary" aria-hidden="true" />
                <span>Frontier line</span>
              </div>
            </Show>
          </Show>
        </div>

      </div>
    </section>
  );
}
