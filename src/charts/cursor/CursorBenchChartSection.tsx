import { createSignal, Show } from "solid-js";
import type { JSX } from "solid-js";
import BenchmarkChartSection from "../../components/BenchmarkChartSection";
import {
  chartStateFromParams,
  chartStateToParams,
} from "../urlState";
import type { ChartViewState, PricingControlState } from "../types";
import {
  CURSOR_BENCH_ID,
  SURCHARGE_CONTROL_ID,
  TOKEN_MIX_CONTROL_ID,
  cursorBenchAdapter,
} from "./adapter";
import type { DerivedCursorChartRecord } from "../../schemas";

export interface CursorBenchChartSectionProps {
  records: () => readonly DerivedCursorChartRecord[];
  /** Optional initial state, typically parsed from the URL by the parent. */
  initialState?: Partial<ChartViewState>;
  /** Called on every interaction-state change so the parent can persist it. */
  onStateChange?: (state: Readonly<ChartViewState>) => void;
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
  // Latest control state, kept in sync via onStateChange for the visible
  // surcharge indicator; the generic section passes its own live controls to
  // adapter.tooltipLines.
  const [controls, setControls] = createSignal<PricingControlState>({
    ...Object.fromEntries(cursorBenchAdapter.controlSpecs.map((spec) => [spec.id, spec.default])),
    ...props.initialState?.controls,
  });

  return (
    <div data-testid="cursor-bench-chart">
      <BenchmarkChartSection
        adapter={cursorBenchAdapter}
        records={props.records}
        initialState={props.initialState}
        onStateChange={(state) => {
          setControls(state.controls);
          props.onStateChange?.(state);
        }}
        isControlVisible={(spec, state) =>
          spec.id !== TOKEN_MIX_CONTROL_ID || Boolean(state[SURCHARGE_CONTROL_ID])
        }
      />
      <Show when={Boolean(controls()[SURCHARGE_CONTROL_ID])}>
        <div class="alert mt-3" role="status" data-testid="cursor-token-rate-assumptions">
          <p class="flex flex-wrap items-center gap-2">
            <span class="font-medium">Cursor Token Rate estimate enabled.</span>
            <span class="badge badge-warning" data-testid="cursor-surcharge-included">Surcharge included</span>
            <span class="text-sm text-base-content/70">Applies to third-party models; see the methodology below.</span>
          </p>
        </div>
      </Show>
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
    controls: { [SURCHARGE_CONTROL_ID]: false },
  });
}
