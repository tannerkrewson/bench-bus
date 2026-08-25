import type { Component } from "solid-js";
import { AA_DEFAULT_CACHE_HIT_RATE } from "../charts/aa/pricing";
import { CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS } from "../schemas";

/** Methodology for the Artificial Analysis and OpenRouter graph. */
export const AaMethodologyContent: Component = () => (
  <div data-testid="aa-methodology-content">
    <p>
      <strong>How to read this.</strong> The score covers selected evaluations. The cost estimates the
      published workload. It is not a bill. Tasks, prompts, tools, latency, and provider access change
      real costs.
    </p>
    <p>
      <strong>Artificial Analysis.</strong> The{" "}
      <a class="link link-hover" href="https://artificialanalysis.ai/" target="_blank" rel="noopener noreferrer">
        Artificial Analysis
      </a>{" "}
      source provides the Intelligence Index score. The chart uses each model&apos;s actual canonical
      benchmark token counts.
    </p>
    <p>
      <strong>OpenRouter pricing.</strong> The{" "}
      <a class="link link-hover" href="https://openrouter.ai/" target="_blank" rel="noopener noreferrer">
        OpenRouter
      </a>{" "}
      snapshot supplies effective prices. Effective prices are 30-day realized averages. Cheapest
      pricing chooses one provider by total workload cost. It never mixes input and output prices from
      different providers. Weighted pricing uses model-wide effective prices.
    </p>
    <p>
      <strong>AA listed pricing.</strong> The chart uses listed rates and the selected cache-hit rate.
      It defaults to {AA_DEFAULT_CACHE_HIT_RATE * 100}%. The source does not publish cache-write volume,
      so the chart omits it.
    </p>
    <p>
      <strong>Discounts.</strong> When OpenRouter publishes a provider discount, or the mapping links a
      discounted tier to an undiscounted model, the chart shows the largest source-backed discount arrow.
      The tooltip identifies a plotted winner or an alternative provider. The chart does not infer
      discounts.
    </p>
    <p>
      <strong>Limits.</strong> One score does not measure every capability, safety, domain, or workflow
      fit. Historical views include only snapshots collected by Bench Bus. Prices and scores may change
      after collection.
    </p>
  </div>
);

/** Methodology for the CursorBench graph. */
export const CursorMethodologyContent: Component = () => (
  <div data-testid="cursor-methodology-content">
    <p>
      <strong>How to read this.</strong> The score and cost describe the published CursorBench workload.
      The cost is an estimate, not a bill. Real tasks can differ.
    </p>
    <p>
      <strong>CursorBench source.</strong> Scores, task costs, and token counts come from the single table
      at{" "}
      <a class="link link-hover" href="https://cursor.com/evals" target="_blank" rel="noopener noreferrer">
        cursor.com/evals
      </a>
      . The chart uses the values as published, with normal display rounding.
    </p>
    <p>
      <strong>Cursor Token Rate.</strong> The optional ${CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS}/M-token
      fee estimates third-party multi-step agent workloads. The estimate uses published completion
      tokens and model rates. It subtracts known output cost and estimates hidden non-output tokens.
      It does not change raw source values. Cursor Models (Grok 4.6, Grok 4.5, and Composer 2.5) do not
      incur this fee.
    </p>
    <p>
      <strong>Cache-hit estimate.</strong> The setting defaults to 90%. It means the percentage of
      non-output prompt tokens assumed to come from cache. Higher cache reuse means more total processed
      tokens for the same published cost, so it raises the estimated fee. The estimate includes input and
      cache-write uncertainty. The 90% value is not a universal measured Cursor rate. If output cost
      exceeds the published cost, or required completion and rate data is missing, the estimate is
      unavailable and the published cost stays unchanged.
    </p>
    <p>
      <strong>Limits.</strong> One score does not measure every capability, safety, domain, or workflow
      fit. Historical views include only snapshots collected by Bench Bus. Prices and scores may change
      after collection.
    </p>
  </div>
);
