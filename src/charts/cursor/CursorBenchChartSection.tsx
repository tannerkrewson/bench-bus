import type { JSX } from "solid-js";
import BenchmarkChartSection from "../../components/BenchmarkChartSection";
import {
  chartStateFromParams,
  chartStateToParams,
} from "../urlState";
import type { ChartViewState } from "../types";
import {
  CURSOR_BENCH_ID,
  SURCHARGE_CONTROL_ID,
  CACHE_HIT_RATE_CONTROL_ID,
  cursorBenchAdapter,
} from "./adapter";
import type { DerivedCursorChartRecord } from "../../schemas";
import { CursorMethodologyContent } from "../../methodology/MethodologyPanel";

export interface CursorBenchChartSectionProps {
  records: () => readonly DerivedCursorChartRecord[];
  /** Optional initial state, typically parsed from the URL by the parent. */
  initialState?: Partial<ChartViewState>;
  /** Called on every interaction-state change so the parent can persist it. */
  onStateChange?: (state: Readonly<ChartViewState>) => void;
  /**
   * Optional observation timestamp (ISO UTC) of the freshest source dataset
   * backing this chart, rendered as a relative freshness badge by the shared
   * generic section.
   */
  lastUpdated?: () => string | null;
}

/**
 * CursorBench score-versus-cost chart section (bench-bus-0cd.11).
 *
 * Thin benchmark-specific wrapper around the generic BenchmarkChartSection:
 * supplies the real Cursor adapter. Control state flows through the generic
 * tooltip contract, so the UI states clearly when the +$0.25/M adjustment is
 * part of a plotted cost.
 */
export default function CursorBenchChartSection(props: CursorBenchChartSectionProps): JSX.Element {
  return (
    <div data-testid="cursor-bench-chart">
      <BenchmarkChartSection
        adapter={cursorBenchAdapter}
        records={props.records}
        lastUpdated={props.lastUpdated}
        initialState={props.initialState}
        onStateChange={props.onStateChange}
        beforeChart={(controls, onControlChange) => (
          <div class="mb-4 rounded-box border border-base-300 bg-base-200/50 p-3" data-testid="cursor-surcharge-toggle">
            <label
              class="label cursor-pointer justify-start gap-3"
              for={`chart-${CURSOR_BENCH_ID}-visible-surcharge`}
            >
              <span class="flex flex-1 flex-col gap-1">
                <span class="font-medium">Include Cursor third-party fee</span>
                <span class="text-sm text-base-content/70">
                  Cursor Teams and Enterprise plans pay the $0.25/M third-party fee; Pro, Pro Plus, and Ultra plans do not.
                </span>
              </span>
              <input
                id={`chart-${CURSOR_BENCH_ID}-visible-surcharge`}
                type="checkbox"
                class="toggle toggle-sm toggle-primary"
                aria-label="Include Cursor third-party fee"
                checked={Boolean(controls()[SURCHARGE_CONTROL_ID])}
                onChange={(event) => onControlChange(SURCHARGE_CONTROL_ID, event.currentTarget.checked)}
              />
            </label>
          </div>
        )}
        isControlVisible={(spec, state) =>
          spec.id !== SURCHARGE_CONTROL_ID &&
          (spec.id !== CACHE_HIT_RATE_CONTROL_ID || Boolean(state[SURCHARGE_CONTROL_ID]))
        }
        showDiscountsControl={false}
        methodology={{
          title: "CursorBench methodology",
          content: <CursorMethodologyContent />,
        }}
      />
    </div>
  );
}

/** Serialize Cursor chart state into URL params under the "chart.cursor" namespace. */
export function cursorChartStateToParams(state: Readonly<ChartViewState>): URLSearchParams {
  return chartStateToParams(state, CURSOR_BENCH_ID);
}

/** Read Cursor chart state from URL params, falling back to adapter defaults. */
export function cursorChartStateFromParams(params: Readonly<URLSearchParams>): ChartViewState {
  return chartStateFromParams(params, CURSOR_BENCH_ID, cursorBenchAdapter.controlSpecs, {
    scale: cursorBenchAdapter.defaultXScale,
    // Keep the historical URL shape compact: the generic section fills the
    // slider default for rendering, while absent slider params stay absent.
    controls: { [SURCHARGE_CONTROL_ID]: true, [CACHE_HIT_RATE_CONTROL_ID]: 90 },
  });
}
