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
    title="CursorBench methodology"
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
      cost. CursorBench tokens-per-task is completion/output tokens, not total
      processed tokens. When completion tokens and a model rate profile are
      available, the estimate subtracts known output cost and infers hidden
      non-output tokens using the selected Token mix assumption from
      cache-heavy to input/write-heavy. The slider is not a measured cache
      ratio; if required pricing is unavailable, the published point remains
      unadjusted. first-party models are unaffected, and the adjustment is
      never baked into the raw values; it is only included when the toggle is
      on.
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
