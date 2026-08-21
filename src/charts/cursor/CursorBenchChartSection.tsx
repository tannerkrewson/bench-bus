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
  cursorEstimateTooltipLines,
  surchargeTooltipLine,
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
 * supplies the real Cursor adapter and augments tooltips with the exact
 * surcharge amount whenever the surcharge toggle is included, so the UI
 * always states clearly when the +$0.25/M adjustment is part of a cost.
 */
export default function CursorBenchChartSection(props: CursorBenchChartSectionProps): JSX.Element {
  // Latest control state, kept in sync via onStateChange so the derived
  // tooltip can react to the surcharge toggle (the frozen generic section's
  // tooltip memo tracks any signal read inside adapter.tooltipLines).
  const [controls, setControls] = createSignal<PricingControlState>({
    [SURCHARGE_CONTROL_ID]: false,
  });

  const adapter = {
    ...cursorBenchAdapter,
    tooltipLines: (record: DerivedCursorChartRecord, point: { x: number; y: number; id: string; label: string }) => {
      const lines = [...cursorBenchAdapter.tooltipLines(record, point)];
      const surchargeLine = surchargeTooltipLine(record, controls());
      if (surchargeLine) lines.push(surchargeLine);
      lines.push(...cursorEstimateTooltipLines(record, controls()));
      return lines;
    },
  };

  return (
    <div data-testid="cursor-bench-chart">
      <BenchmarkChartSection
        adapter={adapter}
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
        <div class="alert mt-3" role="note" data-testid="cursor-token-rate-assumptions">
          <div>
            <p class="font-medium">Cursor Token Rate estimate</p>
            <p class="text-sm">
              The chart subtracts known output cost from each published task cost, then estimates hidden and total tokens.
              The current model-specific rate and fee are shown in each point tooltip.
            </p>
            <p class="text-sm text-base-content/70">
              This is an assumption, not a bill. Rates span cache-heavy to input-heavy endpoints; the tooltip shows the full possible fee and adjusted-cost range. First-party Cursor models are exempt.
            </p>
          </div>
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
