import type { Component, JSX } from "solid-js";

/**
 * Generic score-versus-cost chart contracts.
 *
 * Concrete benchmarks (Artificial Analysis, CursorBench) supply a
 * BenchmarkChartAdapter; the reusable components in src/charts and
 * src/components stay benchmark-agnostic.
 */

/** X-axis scale mode. Log is the default for cost axes spanning decades. */
export type XScale = "log" | "linear";

/** Provider family used for model metadata (not chart color identity). */
export type ModelBrand =
  | "anthropic"
  | "openai"
  | "google"
  | "cursor"
  | "meta"
  | "mistral"
  | "deepseek"
  | "qwen"
  | "xai"
  | "other";

/** One plottable model point. x is estimated cost in USD, y is the score. */
export interface PriceDiscountAnnotation {
  /** Percentage implied by the source-backed pre/effective workload costs (0–100). */
  percentage: number;
  /** Undiscounted workload cost in USD, from the same provider price. */
  preDiscountX: number;
  /** Optional effective cost; a zero is source-valid only for a 100% discount and is never plotted on a log scale. */
  effectiveX?: number;
  /** Provider that supplied both the pre-discount and effective prices. */
  providerName?: string;
  /** Provider whose effective cost determines the plotted point when this is an alternative discount. */
  plottedProviderName?: string;
  /** Explicit model identity used as the undiscounted comparison. */
  undiscountedModelId?: string;
  /** Whether this provider is the plotted winner or an alternative discounted provider. */
  providerRole?: "plotted" | "alternative";
}

export interface PlottablePoint {
  /** Stable model identity (slug or table row id). */
  id: string;
  /** Human-readable concise display name. */
  label: string;
  /** Optional source spelling retained only for accessible selector identity. */
  selectionLabel?: string;
  /** Provider family used to select a recognizable point color. */
  brand?: ModelBrand;
  /** Estimated benchmark workload cost, USD. Must be > 0 for log scale. */
  x: number;
  /** Optional explicit source-backed discount annotation; never inferred by the chart. */
  discount?: PriceDiscountAnnotation;
  /** Source-backed provider discount candidates; the chart displays the largest one. */
  discounts?: readonly PriceDiscountAnnotation[];
  /** Stable model-family key shared by all effort variants and both charts. */
  effortGroup?: string;
  /** Normalized reasoning effort, when this point is an effort variant. */
  effort?: string;
  /** Benchmark score. */
  y: number;
}

/** Value a pricing control can hold. */
export type PricingControlValue = number | boolean | string;

/** Runtime state of all of an adapter's pricing controls. */
export type PricingControlState = Record<string, PricingControlValue>;

/** Discriminated specs so the generic panel can render DaisyUI controls. */
export type PricingControlSpec =
  | {
      kind: "toggle";
      id: string;
      label: string;
      /** Shown under the control; keep to one sentence. */
      description?: string;
      default: boolean;
    }
  | {
      kind: "slider";
      id: string;
      label: string;
      description?: string;
      default: number;
      min: number;
      max: number;
      step: number;
      /** Formats the current value next to the label, e.g. "90%". */
      format?: (value: number) => string;
    }
  | {
      kind: "select";
      id: string;
      label: string;
      description?: string;
      default: string;
      options: readonly { value: string; label: string }[];
    };

/** One label/value row in a hover tooltip. */
export interface TooltipLine {
  label: string;
  value: string;
}

/** A safe external link used inside benchmark subtitle copy. */
export interface ChartSubtitleLink {
  readonly label: string;
  readonly href: string;
}

/** A verified external source link shown below a benchmark chart. */
export type ChartSourceLink = ChartSubtitleLink;

/** Plain text or link parts for a subtitle, kept separate from Solid JSX. */
export type ChartSubtitle = string | readonly (string | ChartSubtitleLink)[];

/**
 * Benchmark-specific adapter. Everything the generic chart cannot know —
 * how to compute cost (including pricing-mode controls), how to filter and
 * describe models, and what the methodology note says — lives here.
 *
 * Type parameter TRecord is the benchmark's derived record type (e.g.
 * DerivedAaChartRecord, DerivedCursorChartRecord from src/schemas).
 */
export interface BenchmarkChartAdapter<TRecord> {
  /** Stable benchmark id, used as the URL-state namespace. */
  readonly benchmarkId: string;
  /** Short plain-English heading shown above this graph. */
  readonly title: string;
  /** Concise explanation of the benchmark score and cost metrics. */
  readonly subtitle: ChartSubtitle;
  /** Verified source pages for the data shown by this benchmark. */
  readonly sourceLinks?: readonly ChartSourceLink[];
  /** Stable id + display label for any record, plotted or not. */
  readonly identity: (record: TRecord) => { readonly id: string; readonly label: string };
  readonly xAxisLabel: string;
  readonly yAxisLabel: string;
  readonly defaultXScale: XScale;
  /** Pricing/mode controls the generic panel renders and URL-serializes. */
  readonly controlSpecs: readonly PricingControlSpec[];
  /**
   * Compute the plotted point for a record under the current control state.
   * Return null to exclude the record (e.g. missing pricing); excluded
   * records are surfaced as "unplottable" rather than mispriced.
   */
  computePoint(record: TRecord, controls: Readonly<PricingControlState>): PlottablePoint | null;
  /** Lowercased haystack used by the search/filter box. */
  searchText(record: TRecord): string;
  /**
   * Optional implicit visibility policy. It is used only when no URL/user
   * selection exists, so newly ingested records can be surfaced by a source
   * without overriding explicit selections.
   */
  defaultSelectionIds?(records: readonly TRecord[], points: readonly PlottablePoint[]): readonly string[];
  /** Optional benchmark-specific label for rows excluded by current pricing. */
  unplottableLabel?(controls: Readonly<PricingControlState>): string;
  /** Optional explanation shown above rows excluded by current pricing. */
  unplottableDescription?(controls: Readonly<PricingControlState>): string;
  /** Tooltip rows for a plotted point under the current control state. */
  tooltipLines(
    record: TRecord,
    point: PlottablePoint,
    controls: Readonly<PricingControlState>,
  ): readonly TooltipLine[];
  /** Optional source-backed OpenRouter model page for the detail modal. */
  openRouterUrl?(record: TRecord): string | undefined;
  /** Optional concise rows for the hover tooltip; detail rows remain modal-only. */
  summaryTooltipLines?(
    record: TRecord,
    point: PlottablePoint,
    controls: Readonly<PricingControlState>,
  ): readonly TooltipLine[];
}

/** Content rendered between a chart section's header and graph. */
export type ChartBeforeContent = (
  controls: () => Readonly<PricingControlState>,
  onControlChange: (id: string, value: PricingControlValue) => void,
) => JSX.Element;

/** Full serializable interaction state of one benchmark chart. */
export interface ChartViewState {
  scale: XScale;
  /** Search/filter query; empty string means no filter. */
  query: string;
  /** Selected model ids (highlighted + shown in the detail list). */
  selectedIds: string[];
  /**
   * Whether `selectedIds` came from an explicit URL/session selection. Absent
   * means the benchmark's default selection (or all models) is active.
   */
  selectionSpecified?: boolean;
  /** Values for adapter.controlSpecs, keyed by spec id. */
  controls: PricingControlState;
  /** Whether model labels should be rendered next to plotted points. */
  showLabels?: boolean;
  /** Whether the Pareto frontier line is visible. */
  showFrontier?: boolean;
  /** Whether Pareto crown decorations are visible. Defaults to true. */
  showCrowns?: boolean;
  /** Whether the largest source-backed discount annotation is visible. */
  showDiscounts?: boolean;
}

/** Result of mapping records through an adapter under a query filter. */
export interface ChartPlotBuild<TRecord> {
  /** Records passing the filter with a successfully computed point. */
  entries: { record: TRecord; point: PlottablePoint }[];
  /** Records matching the filter but excluded because computePoint returned null. */
  unplottable: { record: TRecord; reason: string }[];
}

/** Convenience view of just the plotted points, in record order. */
export function pointsOf<TRecord>(build: Readonly<ChartPlotBuild<TRecord>>): PlottablePoint[] {
  return build.entries.map((e) => e.point);
}

export type { Component };
