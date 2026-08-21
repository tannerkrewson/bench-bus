import { ClipboardList } from "lucide-solid";
import type { Component, JSX } from "solid-js";
import { AA_DEFAULT_CACHE_HIT_RATE } from "../charts/aa/pricing";
import { CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS } from "../schemas";

/**
 * Shared methodology and limitations panel. Native details/summary keeps the
 * long explanation discoverable without crowding the charts.
 */
export const MethodologyPanel: Component<{
  title: string;
  children: JSX.Element;
  class?: string;
}> = (props) => (
  <details
    class={`collapse collapse-arrow overflow-hidden rounded-box bg-base-200 ${props.class ?? ""}`}
    data-methodology-panel
  >
    <summary class="collapse-title cursor-pointer select-none font-medium">
      <ClipboardList aria-hidden="true" class="mr-1 inline-block align-text-bottom" size={16} />
      {props.title}
    </summary>
    <div class="collapse-content space-y-3 text-sm leading-relaxed text-base-content/80">
      {props.children}
    </div>
  </details>
);

/** One concise source, methodology, and limitations area for both charts. */
export const UnifiedLimitationsPanel: Component = () => (
  <MethodologyPanel title="Methodology, sources, and limitations">
    <div class="space-y-3" data-testid="unified-limitations">
      <p data-testid="general-limitation">
        <strong>How to read this.</strong> Scores cover selected evaluations. Cost
        is an estimate for the published workload, not a bill. Real workloads
        differ in tasks, prompts, tools, latency, and provider access.
      </p>
      <p>
        <strong>Artificial Analysis.</strong> The Intelligence Index score comes
        from{" "}
        <a
          class="link link-hover"
          href="https://artificialanalysis.ai/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Artificial Analysis
        </a>
        . Cost uses each model&apos;s actual canonical
        benchmark token counts. Cheapest pricing uses one OpenRouter provider;
        it never mixes input and output prices across providers. Weighted pricing
        uses model-wide effective prices. AA listed pricing uses listed rates and
        the selected cache-hit rate (default {AA_DEFAULT_CACHE_HIT_RATE * 100}%).
        Cache-write volume is not published, so it is omitted.
      </p>
      <p>
        <strong>OpenRouter prices.</strong> Effective prices are 30-day realized
        averages from a snapshot. They can change, and the cheapest provider may
        not be available later. When OpenRouter publishes an explicit provider
        discount, the chart shows the largest source-backed discount arrow and
        tooltip details. The tooltip distinguishes a discounted plotted winner
        from a discounted alternative provider; discounts are never inferred
        from price ratios.
      </p>
      <p>
        <strong>CursorBench.</strong> Scores, per-task costs, and aggregate token
        counts come from the single table at{" "}
        <a
          class="link link-hover"
          href="https://cursor.com/evals"
          target="_blank"
          rel="noopener noreferrer"
        >
          cursor.com/evals
        </a>
        . Values are rounded as published. The optional ${CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS}/M-token
        third-party fee is a neutral Token mix estimate: it infers hidden
        non-output tokens from published costs and completion tokens, using a
        logarithmic blend across each model&apos;s valid input, cache-read, and
        cache-write rates. This Token mix assumption is not a literal cache-hit
        percentage. If the known output cost exceeds published cost, the
        estimate is unavailable and published cost remains unchanged. The fee is
        added to published cost when the estimate is valid. Raw source values
        are not changed.
      </p>
      <p>
        <strong>Limits.</strong> One score does not measure every capability,
        safety, domain, or workflow fit. Historical views include only snapshots
        collected by Bench Bus. Prices and scores may change after collection.
      </p>
    </div>
  </MethodologyPanel>
);
