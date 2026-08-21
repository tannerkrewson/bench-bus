import type { Component, JSX } from "solid-js";

/**
 * Shared collapsible methodology/limitations panel (bench-bus-0cd.13).
 *
 * Uses the native <details>/<summary> pair so the toggle is keyboard
 * accessible (Enter/Space on the summary) and collapsed by default — the
 * primary graph stays uncluttered while the methodology stays discoverable.
 */
export const MethodologyPanel: Component<{
  title: string;
  children: JSX.Element;
  class?: string;
}> = (props) => (
  <details
    class={`collapse collapse-arrow bg-base-200 rounded-box ${props.class ?? ""}`}
    data-methodology-panel
  >
    <summary class="collapse-title cursor-pointer font-medium select-none">
      <span aria-hidden="true" class="mr-1">
        📋
      </span>
      {props.title}
    </summary>
    <div class="collapse-content text-sm text-base-content/80 space-y-3">{props.children}</div>
  </details>
);

/**
 * The general limitation that applies to every chart: a benchmark score and a
 * historical effective price are NOT a universal measure of real-world model
 * value. Both panels render this so no chart can imply otherwise.
 */
export const GeneralLimitationNote: Component = () => (
  <p data-testid="general-limitation">
    <strong>General limitation:</strong> a benchmark score — and a historical
    effective price — is <strong>not a universal measure of real-world model value</strong>.
    Real workloads differ in task mix, prompts, tools, latency needs, and
    negotiation leverage; treat these charts as one input among several, never
    as a verdict.
  </p>
);
