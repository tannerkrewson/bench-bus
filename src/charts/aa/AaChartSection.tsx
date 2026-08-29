import { Crown } from "lucide-solid";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import BenchmarkScatterChart from "../BenchmarkScatterChart";
import ChartDetailModal from "../ChartDetailModal";
import ChartTooltip from "../ChartTooltip";
import ChartWatermark from "../../components/ChartWatermark";
import ChartSources from "../../components/ChartSources";
import { buildChartPlot } from "../plotData";
import type {
  ChartViewState,
  PlottablePoint,
  PriceDiscountAnnotation,
  PricingControlState,
  TooltipLine,
} from "../types";
import { timeVaryingDiscountNote } from "../../content/discountNotes";
import ChartControlPanel from "../../components/ChartControlPanel";
import ModelList from "../../components/ModelList";
import type { DerivedAaChartRecord } from "../../schemas";
import { aaAdapter, aaControlledTooltipLines, aaYAxisLabel } from "./adapter";
import { AA_DEFAULT_CACHE_HIT_RATE } from "./pricing";
import {
  discountDetailLines,
  discountHoverTitle,
  discountSummaryLines,
  largestExplicitDiscountForPoint,
  paretoFrontier,
} from "../plotData";
import { AA_DEFAULT_COST_MODE, AA_DEFAULT_MODEL_SLUGS } from "./constants";
import { isNonReasoningModel, modelGroupKey } from "../modelMetadata";
import MethodologyModal from "../../methodology/MethodologyModal";
import { AaMethodologyContent } from "../../methodology/MethodologyPanel";
import RelativeLastUpdated from "../../components/RelativeLastUpdated";
import ChartSubtitleContent from "../../components/ChartSubtitle";

export interface AaChartSectionProps {
  records: () => readonly DerivedAaChartRecord[];
  /** Optional initial state, typically parsed from the current URL. */
  initialState?: Partial<ChartViewState>;
  /** Called on every interaction-state change for URL persistence. */
  onStateChange?: (state: Readonly<ChartViewState>) => void;
  /**
   * Optional observation timestamp (ISO UTC) of the freshest source dataset
   * backing this chart, rendered as a relative freshness badge.
   */
  lastUpdated?: () => string | null;
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
  // An absent selection is the curated AA view. A non-empty initial
  // selection is explicit URL/session state and must win over the defaults.
  const [selectionSpecified, setSelectionSpecified] = createSignal(
    props.initialState?.selectionSpecified ?? (props.initialState?.selectedIds?.length ?? 0) > 0,
  );
  const [showLabels, setShowLabels] = createSignal(props.initialState?.showLabels ?? true);
  const [showFrontier, setShowFrontier] = createSignal(props.initialState?.showFrontier ?? false);
  const [showCrowns, setShowCrowns] = createSignal(props.initialState?.showCrowns ?? true);
  const [showDiscounts, setShowDiscounts] = createSignal(props.initialState?.showDiscounts ?? true);
  const [controls, setControls] = createSignal<PricingControlState>({
    ...defaultControls(),
    ...props.initialState?.controls,
  });

  const [hovered, setHovered] = createSignal<{
    id: string;
    left: number;
    top: number;
    discount?: PriceDiscountAnnotation;
  } | null>(null);
  const [selectedPointId, setSelectedPointId] = createSignal<string | null>(null);
  const visibleRecords = createMemo(() =>
    props.records().filter((record) => !isNonReasoningModel(record.name, record.slug)),
  );

  const allBuild = createMemo(() =>
    buildChartPlot(visibleRecords(), aaAdapter, controls(), ""),
  );
  const dynamicDefaultIds = createMemo(() => {
    const listedBuild = buildChartPlot(
      visibleRecords(),
      aaAdapter,
      { ...defaultControls(), pricingMode: "listed", cacheHitRate: AA_DEFAULT_CACHE_HIT_RATE },
      "",
    );
    const frontierPoints = paretoFrontier(listedBuild.entries.map((entry) => entry.point));
    const frontierGroups = new Set(
      frontierPoints.map((point) => point.effortGroup).filter((group): group is string => group !== undefined),
    );
    // A frontier family represents a connected reasoning-effort family, not
    // just the one variant that happened to win. Include every other
    // reasoning variant with the same name/version, while never pulling in a
    // non-reasoning base model merely because it shares that family key.
    const frontierVariantIds = listedBuild.entries
      .filter(({ point }) => point.effortGroup !== undefined && point.effort !== undefined && frontierGroups.has(point.effortGroup))
      .map(({ point }) => point.id);
    return [...new Set([...AA_DEFAULT_MODEL_SLUGS, ...frontierPoints.map((point) => point.id), ...frontierVariantIds])];
  });
  const [selectedIds, setSelectedIds] = createSignal<string[]>(
    selectionSpecified()
      ? [...(props.initialState?.selectedIds ?? [])]
      : dynamicDefaultIds(),
  );
  // A default selection follows each newly loaded snapshot. Once a URL or user
  // interaction specifies a selection, it remains untouched by snapshot updates.
  createEffect(() => {
    const defaults = dynamicDefaultIds();
    if (!selectionSpecified()) setSelectedIds(defaults);
  });
  // Keep the selector filter independent from chart visibility: the selector
  // searches all priced models, while the chart contains only selected models.
  // Missing default slugs simply have no matching entry and cannot break plot.
  const build = createMemo(() => {
    const candidate = allBuild();
    const selected = new Set(selectedIds());
    return {
      entries: candidate.entries.filter((entry) => selected.has(entry.point.id)),
      // Unplottable records remain visible in the selector regardless of
      // selection so missing upstream pricing is explained, never estimated.
      unplottable: candidate.unplottable,
    };
  });

  // Visibility filtering is handled by `build`; unselected models are omitted
  // from the chart rather than painted as a second selection layer.

  type ChartEntry = ReturnType<typeof build>["entries"][number];
  const discountFor = (entry: ChartEntry) =>
    showDiscounts() ? largestExplicitDiscountForPoint(entry.point) : null;
  const summaryLinesFor = (
    entry: ChartEntry,
    discount = discountFor(entry),
  ): readonly TooltipLine[] => {
    const lines = aaControlledTooltipLines(entry.record, entry.point, controls()).slice(0, 2);
    return discount ? [...lines, ...discountSummaryLines(entry.point, discount)] : lines;
  };
  const detailLinesFor = (entry: ChartEntry): readonly TooltipLine[] => {
    const lines = [...aaControlledTooltipLines(entry.record, entry.point, controls())];
    const discount = discountFor(entry);
    return discount ? [...lines, ...discountDetailLines(entry.point, discount)] : lines;
  };
  /** Caveat for providers whose off-peak discount windows move around. */
  const discountNoteFor = (point: PlottablePoint, discount: PriceDiscountAnnotation | null) =>
    discount
      ? timeVaryingDiscountNote({
          id: point.id,
          label: point.label,
          providers: [point.brand, discount.providerName],
        })
      : null;

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
    discountNote: string | null;
  } | null>(() => {
    const id = selectedPointId();
    if (!id) return null;
    const entry = build().entries.find((e) => e.point.id === id);
    return entry
      ? {
          title: entry.point.label,
          lines: detailLinesFor(entry),
          openRouterUrl: aaAdapter.openRouterUrl?.(entry.record),
          discountNote: discountNoteFor(entry.point, discountFor(entry)),
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
      showDiscounts: showDiscounts(),
    });
  };
  createEffect(emitState);

  const toggleSelect = (id: string) => {
    setSelectionSpecified(true);
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const resetDefault = () => {
    setSelectionSpecified(false);
    setSelectedIds(dynamicDefaultIds());
    setQuery("");
  };

  const setControl = (id: string, value: number | boolean | string) => {
    setControls((prev) => ({ ...prev, [id]: value }));
  };

  return (
    <section
      class="card bg-base-100 border-base-300 border shadow-sm"
      data-benchmark={aaAdapter.benchmarkId}
      aria-label={`Artificial Analysis ${AA_DEFAULT_COST_MODE}`}
    >
      <div class="card-body">
        <header class="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div class="min-w-0 flex-1">
            <h2 id={`chart-title-${aaAdapter.benchmarkId}`} class="card-title text-2xl">
              <a
                href={`#chart-title-${aaAdapter.benchmarkId}`}
                class="link link-hover"
                data-testid="chart-title-link"
              >
                {aaAdapter.title}
              </a>
            </h2>
            <div class="mt-1 flex flex-wrap items-center gap-2">
              <p class="whitespace-pre-line text-sm text-base-content/70" data-testid="chart-subtitle">
                <ChartSubtitleContent content={aaAdapter.subtitle} />
              </p>
              <RelativeLastUpdated timestamp={props.lastUpdated} />
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2">
            <ChartControlPanel
              benchmarkId={aaAdapter.benchmarkId}
              scale={scale}
              onScaleChange={setScale}
              specs={aaAdapter.controlSpecs}
              controls={controls}
              onControlChange={setControl}
              showLabels={showLabels}
              onShowLabelsChange={setShowLabels}
              showFrontier={showFrontier}
              onShowFrontierChange={setShowFrontier}
              showCrowns={showCrowns}
              onShowCrownsChange={setShowCrowns}
              showDiscounts={showDiscounts}
              onShowDiscountsChange={setShowDiscounts}
              isControlVisible={(spec) =>
                spec.id !== "cacheHitRate" || controls().pricingMode === "listed"
              }
            />
            <Show when={visibleRecords().length > 0}>
              <ModelList
                points={() => allBuild().entries.map((e) => e.point)}
                selectedIds={selectedIds}
                defaultSelectedIds={dynamicDefaultIds}
                searchId={`chart-${aaAdapter.benchmarkId}-model-search`}
                onResetDefault={resetDefault}
                query={query}
                onQueryChange={setQuery}
                onToggleSelect={toggleSelect}
                unplottable={() => allBuild().unplottable.map((u) => aaAdapter.identity(u.record))}
              />
            </Show>
            <MethodologyModal
              benchmarkId={aaAdapter.benchmarkId}
              title="Artificial Analysis and OpenRouter methodology"
            >
              <AaMethodologyContent />
            </MethodologyModal>
          </div>
        </header>
        <div class="relative min-h-[560px] sm:min-h-[740px]" data-testid="chart-area">
          <Show
            when={visibleRecords().length > 0}
            fallback={
              <p class="rounded-box bg-base-200 p-8 text-center" role="status" data-testid="aa-empty">
                No Artificial Analysis data available yet. Snapshots are collected automatically;
                check back soon.
              </p>
            }
          >
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
              {/* Keep the plot readable on portrait screens. The scroll viewport
                  is intentionally narrower than this minimum plot width; at
                  sm and above the chart returns to its normal fluid width. */}
              <div class="w-full overflow-x-auto overscroll-x-contain" data-testid="chart-scroll">
                <div class="relative min-w-[720px] sm:min-w-0" data-testid="chart-scroll-content">
                  <BenchmarkScatterChart
                    points={() => build().entries.map((e) => e.point)}
                    colorGroupKeys={() => allBuild().entries.map(({ point }) =>
                      point.effortGroup ?? modelGroupKey(point.label, point.id),
                    )}
                    scale={scale}
                    showLabels={showLabels}
                    showFrontier={showFrontier}
                    showCrowns={showCrowns}
                    showDiscounts={showDiscounts}
                    xAxisLabel={() => aaAdapter.xAxisLabel}
                    yAxisLabel={() => aaYAxisLabel(controls())}
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
                  <div class="absolute bottom-20 left-32 z-10">
                    <ChartWatermark />
                  </div>
                </div>
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
            <ChartSources
              benchmarkId={aaAdapter.benchmarkId}
              content={aaAdapter.subtitle}
              sourceLinks={aaAdapter.sourceLinks}
            />
          </Show>
        </div>
        <ChartDetailModal
          benchmarkId={aaAdapter.benchmarkId}
          open={() => selectedInfo() !== null}
          title={() => selectedInfo()?.title ?? null}
          lines={() => selectedInfo()?.lines ?? []}
          openRouterUrl={() => selectedInfo()?.openRouterUrl}
          discountNote={() => selectedInfo()?.discountNote ?? null}
          onClose={() => setSelectedPointId(null)}
        />
      </div>
    </section>
  );
}
