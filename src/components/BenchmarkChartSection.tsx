import { Crown } from "lucide-solid";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import type { JSX } from "solid-js";
import BenchmarkScatterChart from "../charts/BenchmarkScatterChart";
import ChartDetailModal from "../charts/ChartDetailModal";
import ChartTooltip from "../charts/ChartTooltip";
import ChartWatermark from "./ChartWatermark";
import {
  buildChartPlot,
  discountDetailLines,
  discountHoverTitle,
  discountSummaryLines,
  largestExplicitDiscountForPoint,
} from "../charts/plotData";
import type {
  BenchmarkChartAdapter,
  ChartViewState,
  PricingControlSpec,
  PricingControlState,
  PriceDiscountAnnotation,
  TooltipLine,
} from "../charts/types";
import ChartControlPanel from "./ChartControlPanel";
import ModelList from "./ModelList";
import MethodologyModal from "../methodology/MethodologyModal";
import RelativeLastUpdated from "./RelativeLastUpdated";
import ChartSubtitleContent from "./ChartSubtitle";

export interface ChartMethodology {
  title: string;
  content: JSX.Element;
}

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
  /** Whether this benchmark supports source-backed provider discounts. */
  showDiscountsControl?: boolean;
  /** Optional graph-specific methodology content for concrete sections. */
  methodology?: ChartMethodology;
  /**
   * Optional observation timestamp (ISO UTC) of the freshest source dataset
   * backing this chart, rendered as a relative freshness badge.
   */
  lastUpdated?: () => string | null;
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
  const showDiscountsControl = props.showDiscountsControl !== false;
  const [showCrowns, setShowCrowns] = createSignal(props.initialState?.showCrowns ?? true);
  const [showDiscounts, setShowDiscounts] = createSignal(
    showDiscountsControl ? props.initialState?.showDiscounts ?? true : false,
  );
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
    discount?: PriceDiscountAnnotation;
  } | null>(null);
  const [selectedPointId, setSelectedPointId] = createSignal<string | null>(null);

  const effectiveSelectedIds = createMemo(() =>
    selectionSpecified() ? selectedIds() : defaultSelectionIds(),
  );
  const visibleEntries = createMemo(() => {
    const ids = new Set(effectiveSelectedIds());
    return build().entries.filter((entry) => ids.has(entry.point.id));
  });

  type ChartEntry = ReturnType<typeof build>["entries"][number];
  const discountFor = (entry: ChartEntry) =>
    showDiscountsControl && showDiscounts() ? largestExplicitDiscountForPoint(entry.point) : null;
  const summaryLinesFor = (
    entry: ChartEntry,
    discount = discountFor(entry),
  ): readonly TooltipLine[] => {
    const lines = props.adapter.summaryTooltipLines?.(entry.record, entry.point, controls()) ??
      props.adapter.tooltipLines(entry.record, entry.point, controls()).slice(0, 2);
    return discount ? [...lines, ...discountSummaryLines(entry.point, discount)] : lines;
  };
  const detailLinesFor = (entry: ChartEntry): readonly TooltipLine[] => {
    const lines = [...props.adapter.tooltipLines(entry.record, entry.point, controls())];
    const discount = discountFor(entry);
    return discount ? [...lines, ...discountDetailLines(entry.point, discount)] : lines;
  };

  const hoveredInfo = createMemo<{ title: string; lines: readonly TooltipLine[] } | null>(() => {
    const h = hovered();
    if (!h) return null;
    const entry = build().entries.find((e) => e.point.id === h.id);
    if (!entry) return null;
    const discount = h.discount ?? discountFor(entry);
    return {
      title: discount ? discountHoverTitle(entry.point, discount) : entry.point.label,
      lines: summaryLinesFor(entry, discount),
    };
  });
  const selectedInfo = createMemo<{
    title: string;
    lines: readonly TooltipLine[];
    openRouterUrl: string | undefined;
  } | null>(() => {
    const id = selectedPointId();
    if (!id) return null;
    const entry = build().entries.find((e) => e.point.id === id);
    return entry
      ? {
          title: entry.point.label,
          lines: detailLinesFor(entry),
          openRouterUrl: props.adapter.openRouterUrl?.(entry.record),
        }
      : null;
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
      showCrowns: showCrowns(),
      ...(showDiscountsControl ? { showDiscounts: showDiscounts() } : {}),
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
        <header class="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div class="min-w-0 flex-1">
            <h2 id={`chart-title-${props.adapter.benchmarkId}`} class="card-title text-2xl">
              <a
                href={`#chart-title-${props.adapter.benchmarkId}`}
                class="link link-hover"
                data-testid="chart-title-link"
              >
                {props.adapter.title}
              </a>
            </h2>
            <div class="mt-1 flex flex-wrap items-center gap-2">
              <p class="text-sm text-base-content/70" data-testid="chart-subtitle">
                <ChartSubtitleContent content={props.adapter.subtitle} />
              </p>
              <RelativeLastUpdated timestamp={props.lastUpdated} />
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2">
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
              showCrowns={showCrowns}
              onShowCrownsChange={setShowCrowns}
              showDiscounts={showDiscountsControl ? showDiscounts : undefined}
              onShowDiscountsChange={showDiscountsControl ? setShowDiscounts : undefined}
            />
            <Show when={props.records().length > 0}>
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
            </Show>
            <Show when={props.methodology}>
              {(methodology) => (
                <MethodologyModal benchmarkId={props.adapter.benchmarkId} title={methodology().title}>
                  {methodology().content}
                </MethodologyModal>
              )}
            </Show>
          </div>
        </header>
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
                    showCrowns={showCrowns}
                    showDiscounts={showDiscountsControl ? showDiscounts : undefined}
                    xAxisLabel={() => props.adapter.xAxisLabel}
                    yAxisLabel={() => props.adapter.yAxisLabel}
                     onHover={(id, pos, details) =>
                       setHovered(id && pos ? { id, left: pos.left, top: pos.top, discount: details?.discount } : null)
                     }
                    onSelectPoint={setSelectedPointId}
                  />
                  <ChartTooltip
                    left={() => hovered()?.left ?? 0}
                    top={() => hovered()?.top ?? 0}
                    title={() => hoveredInfo()?.title ?? null}
                    lines={() => hoveredInfo()?.lines ?? []}
                  />
                </div>
              </div>
              <div class="absolute bottom-20 left-32 z-10 rounded-box bg-base-100/90 px-2 py-1 shadow-sm ring-1 ring-base-300">
                <ChartWatermark />
              </div>
            </Show>
            <div class="mt-2 flex flex-wrap items-center justify-center gap-4 text-sm text-base-content/70">
              <Show when={showFrontier()}>
                <div class="flex items-center gap-2" role="img" aria-label="Pareto frontier (dotted line)">
                  <span class="w-6 border-t-2 border-dashed border-primary" aria-hidden="true" />
                  <span>Frontier line</span>
                </div>
              </Show>
              <Show when={showCrowns()}>
                <div class="flex items-center gap-2" role="img" aria-label="Pareto crown (best value frontier model)">
                  <span class="text-base-content" aria-hidden="true" data-testid="legend-crown">
                    <Crown size={18} stroke-width={2.5} />
                  </span>
                  <span>Frontier crown</span>
                </div>
              </Show>
            </div>
          </Show>
        </div>

        <ChartDetailModal
          benchmarkId={props.adapter.benchmarkId}
          open={() => selectedInfo() !== null}
          title={() => selectedInfo()?.title ?? null}
          lines={() => selectedInfo()?.lines ?? []}
          openRouterUrl={() => selectedInfo()?.openRouterUrl}
          onClose={() => setSelectedPointId(null)}
        />

      </div>
    </section>
  );
}
