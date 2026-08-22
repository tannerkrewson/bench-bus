import { Crown } from "lucide-solid";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import BenchmarkScatterChart from "../BenchmarkScatterChart";
import ChartTooltip from "../ChartTooltip";
import ChartWatermark from "../../components/ChartWatermark";
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
import { AA_DEFAULT_CACHE_HIT_RATE, listedCostUsd } from "./pricing";
import {
  discountProviderRole,
  largestExplicitDiscountForPoint,
  paretoFrontier,
} from "../plotData";
import { AA_DEFAULT_COST_MODE, AA_DEFAULT_MODEL_SLUGS } from "./constants";
import { isNonReasoningModel } from "../modelMetadata";

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
  } | null>(null);
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

  const hoveredInfo = createMemo<{ title: string; lines: readonly TooltipLine[] } | null>(() => {
    const h = hovered();
    if (!h) return null;
    const entry = build().entries.find((e) => e.point.id === h.id);
    if (!entry) return null;
    const lines = [...aaControlledTooltipLines(entry.record, entry.point, controls())];
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
        <header class="mb-1">
          <h2 class="card-title text-2xl">{aaAdapter.title}</h2>
          <p class="mt-1 text-sm text-base-content/70">{aaAdapter.subtitle}</p>
        </header>
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
          <div class="mb-3 flex justify-end">
            <ModelList
              points={() => allBuild().entries.map((e) => e.point)}
              selectedIds={selectedIds}
              defaultSelectedIds={dynamicDefaultIds}
              searchId={`chart-${aaAdapter.benchmarkId}-model-search`}
              onResetDefault={resetDefault}
              query={query}
              onQueryChange={setQuery}
              onToggleSelect={toggleSelect}
              unplottableLabel={() => aaAdapter.unplottableLabel?.(controls()) ?? "no pricing"}
              unplottableDescription={() =>
                aaAdapter.unplottableDescription?.(controls()) ??
                "Unavailable with the current pricing settings."
              }
              unplottable={() => allBuild().unplottable.map((u) => aaAdapter.identity(u.record))}
            />
          </div>
        </Show>
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
                    scale={scale}
                    showLabels={showLabels}
                    showFrontier={showFrontier}
                    showCrowns={showCrowns}
                    showDiscounts={showDiscounts}
                    xAxisLabel={() => aaAdapter.xAxisLabel}
                    yAxisLabel={() => aaAdapter.yAxisLabel}
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
            <div class="mt-2 flex flex-wrap items-center justify-center gap-4 text-sm text-base-content/70">
              <Show when={showFrontier()}>
                <div class="flex items-center gap-2" role="img" aria-label="Pareto frontier (dotted line)">
                  <span class="w-6 border-t-2 border-dashed border-primary" aria-hidden="true" />
                  <span>Frontier line</span>
                </div>
              </Show>
              <Show when={showCrowns()}>
                <div class="flex items-center gap-2" role="img" aria-label="Pareto crown (best value frontier model)">
                  <Crown size={18} aria-hidden="true" />
                  <span>Frontier crown</span>
                </div>
              </Show>
            </div>
          </Show>
        </div>
        <Show when={visibleRecords().length > 0 && build().unplottable.length > 0}>
          <p class="text-xs text-base-content/60" role="status" data-testid="aa-unplottable-count">
            {build().unplottable.length} model(s) shown in the list but not plotted: no usable
            pricing for the current mode — never estimated as $0.
            <Show
              when={
                controls().pricingMode !== "listed" &&
                build().unplottable.filter((entry) =>
                  listedCostUsd(
                    entry.record.listed,
                    entry.record.canonicalTokens.input,
                    entry.record.canonicalTokens.output,
                    AA_DEFAULT_CACHE_HIT_RATE,
                  ) !== null,
                ).length > 0
              }
            >
              <span data-testid="aa-listed-availability">
                Some have AA listed pricing; switch Pricing mode to “AA listed” to plot them.
              </span>
            </Show>
          </p>
        </Show>
      </div>
    </section>
  );
}
