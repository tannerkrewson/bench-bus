import type { Component } from "solid-js";
import { CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS } from "../schemas";
import { MethodologyPanel } from "./MethodologyPanel";

/**
 * Methodology & limitations for the CursorBench score vs. cost chart
 * (bench-bus-0cd.13). Collapsed by default; the summary line is the
 * discoverability affordance.
 */
export const CursorMethodologyPanel: Component<{ class?: string }> = (props) => (
  <MethodologyPanel
    title="Methodology & limitations — CursorBench chart"
    class={props.class}
  >
    <p>
      <strong>What is plotted.</strong> The Y axis is the CursorBench score and
      the X axis is the benchmark workload cost as published in the single
      benchmark table at cursor.com/evals — the authoritative source for this
      chart. Costs come from the table{"'"}s real per-task figures, not from a
      hypothetical normalized usage model.
    </p>
    <p>
      <strong>Third-party surcharge.</strong> The toggle adds Cursor
      {"'"}s flat ${CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS} per million
      tokens surcharge for third-party models, applied on top of the published
      cost using the table{"'"}s aggregate tokens-per-task volume. It is never
      baked into the raw values: first-party models are unaffected, and the
      adjustment is only included when the toggle is on (the chart states
      clearly when it is part of a plotted cost).
    </p>
    <p>
      <strong>Published values are display-rounded.</strong> The source table
      publishes rounded figures (scores to a fraction of a percent, costs to
      cents), so plotted points inherit that rounding; tiny differences between
      nearby models may not be meaningful.
    </p>
    <p>
      <strong>One benchmark, one snapshot.</strong> CursorBench measures
      performance on Cursor{"'"}s selected agentic coding tasks only. The score
      reduces each model to a single number for that setting — it does not
      measure general assistant quality, other domains, or your specific
      workflow. Table contents change as Cursor updates the benchmark, and
      historical views only go back as far as Bench Bus has been collecting
      snapshots.
    </p>
  </MethodologyPanel>
);

export default CursorMethodologyPanel;
