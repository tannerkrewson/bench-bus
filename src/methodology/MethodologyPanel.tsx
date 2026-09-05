import type { Component } from "solid-js";
import { AA_DEFAULT_CACHE_HIT_RATE } from "../charts/aa/pricing";
import { CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS } from "../schemas";

/** Methodology for the Artificial Analysis and OpenRouter graph. */
export const AaMethodologyContent: Component = () => (
  <div data-testid="aa-methodology-content">
    <p>
      <strong>How to read this.</strong> Scores cover chosen tests. Cost is an estimate, not a bill.
    </p>
    <p>
      <strong>Score source.</strong>{" "}
      <a class="link link-hover" href="https://artificialanalysis.ai/" target="_blank" rel="noopener noreferrer">
        Artificial Analysis
      </a>{" "}
      publishes the default score. The Score source control can instead use{" "}
      <a class="link link-hover" href="https://deepswe.datacurve.ai/artifacts/v1/leaderboard-live.json" target="_blank" rel="noopener noreferrer">
        DeepSWE pass@1
      </a>{" "}
      scores; models without a score in the selected source are omitted. Token counts come from real test runs.
    </p>
    <p>
      <strong>Price source.</strong>{" "}
      <a class="link link-hover" href="https://openrouter.ai/" target="_blank" rel="noopener noreferrer">
        OpenRouter
      </a>{" "}
      lists average prices paid over 30 days. Cheapest mode picks one regular provider, never two; OpenAI Flex is
      excluded by default because it trades lower cost for higher latency and lower availability. The Include OpenAI
      Flex setting opts into that tier. Weighted mode uses model-wide averages.
    </p>
    <p>
      <strong>Listed prices.</strong> AA costs use listed rates and your cache-hit choice (default{" "}
      {AA_DEFAULT_CACHE_HIT_RATE * 100}%). Cache writes are left out because the source hides them.
    </p>
    <p>
      <strong>Price savings.</strong> Arrows compare the cheapest regular effective OpenRouter provider with AA listed
      pricing for the same workload. Near-equal costs omit the arrow. The tooltip names the winning provider.
    </p>
    <p>
      <strong>Limits.</strong> No score covers every skill. Real costs vary by task. Old views hold only Bench Bus
      snapshots. Prices and scores can change.
    </p>
  </div>
);

/** Methodology for the CursorBench graph. */
export const CursorMethodologyContent: Component = () => (
  <div data-testid="cursor-methodology-content">
    <p>
      <strong>How to read this.</strong> Score and cost describe one fixed workload. Cost is an estimate, not a bill.
    </p>
    <p>
      <strong>Data source.</strong>{" "}
      <a class="link link-hover" href="https://cursor.com/evals" target="_blank" rel="noopener noreferrer">
        cursor.com/evals
      </a>{" "}
      holds all numbers in one table. We show them as published, with display rounding only.
    </p>
    <p>
      <strong>Cursor Token Rate.</strong> This adds an optional $
      {CURSOR_THIRD_PARTY_SURCHARGE_PER_1M_TOKENS} per 1M-token fee. It estimates third-party multi-step agent
      workloads from published output tokens and prices. Raw values stay unchanged. Cursor Models (Grok 4.6, Grok 4.5,
      and Composer 2.5) pay no fee.
    </p>
    <p>
      <strong>Cache-hit setting.</strong> It starts at 90%: the share of non-output prompt tokens assumed to come from
      cache. Higher reuse means a higher fee. That default is not a measured rate. If the math fails or data is missing,
      we hide the estimate and keep the cost.
    </p>
    <p>
      <strong>Limits.</strong> No score covers every skill. Real costs vary by task. Old views hold only Bench Bus
      snapshots. Prices and scores can change.
    </p>
  </div>
);
