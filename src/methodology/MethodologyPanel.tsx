import { ClipboardList } from "lucide-solid";
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
      <ClipboardList aria-hidden="true" class="mr-1 inline-block align-text-bottom" size={16} />
      {props.title}
    </summary>
    <div class="collapse-content text-sm text-base-content/80 space-y-3">{props.children}</div>
  </details>
);

/**
 * One shared, plain-English caveat section for both charts. Keeping this in a
 * single place prevents repeated warnings from competing with the graphs.
 */
export const UnifiedLimitationsPanel: Component = () => (
  <MethodologyPanel title="Limitations & caveats">
    <div class="space-y-3" data-testid="unified-limitations">
      <p data-testid="general-limitation">
        <strong>Use these as context, not a verdict.</strong> A benchmark score
        and historical effective price are not a universal measure of real-world
        model value. Real workloads differ in tasks, prompts, tools, latency, and
        provider availability.
      </p>
      <p>
        <strong>Prices and scores can change.</strong> Costs are estimates based
        on the selected snapshot and published inputs; providers and benchmark
        publishers may update them later.
      </p>
      <p>
        <strong>One benchmark is not the whole picture.</strong> These charts do
        not measure every capability, safety consideration, or fit for your
        workflow. Check the underlying methodology before comparing models.
      </p>
    </div>
  </MethodologyPanel>
);
