import type { Component } from "solid-js";
import { AA_DEFAULT_CACHE_HIT_RATE } from "../charts/aa/pricing";
import { GeneralLimitationNote, MethodologyPanel } from "./MethodologyPanel";

/**
 * Methodology & limitations for the Artificial Analysis Intelligence Index
 * vs. estimated benchmark workload cost chart (bench-bus-0cd.13).
 *
 * Collapsed by default so it never crowds the primary graph; the summary line
 * is the discoverability affordance.
 */
export const AaMethodologyPanel: Component<{ class?: string }> = (props) => (
  <MethodologyPanel
    title="Methodology & limitations — Artificial Analysis Intelligence Index chart"
    class={props.class}
  >
    <p>
      <strong>What is plotted.</strong> The Y axis is Artificial Analysis'
      Intelligence Index. The X axis estimates what the model
      {"'"}s <em>actual canonical Intelligence Index benchmark workload</em> would
      cost: the cost is computed from the canonical token counts Artificial
      Analysis publishes for that benchmark (how many input and output tokens
      the model needed), multiplied by the pricing mode you select. There is
      deliberately no normalized or hypothetical workload mode.
    </p>
    <p>
      <strong>Pricing modes.</strong> "Cheapest single provider" picks one real
      OpenRouter provider by the combined input+output cost for the actual
      benchmark workload — input and output prices are never mixed across
      providers. "OpenRouter weighted" uses model-wide weighted effective
      prices. "AA listed" uses Artificial Analysis
      {"'"}s listed prices with a cache-hit estimate: a user-adjustable share of
      input tokens (defaulting to {AA_DEFAULT_CACHE_HIT_RATE * 100}%) is priced
      at the cache-hit price and the rest at the normal input price.
    </p>
    <p>
      <strong>Cache writes are unknown and omitted.</strong> The listed-price
      estimate deliberately ignores cache-write volume: upstream cache-write
      token counts are not published, so inventing them would misprice the
      workload. Cache-hit results therefore depend on the hit rate you select
      and are approximations even then.
    </p>
    <p>
      <strong>Effective prices change over time.</strong> OpenRouter effective
      prices are observed averages; the cheapest-provider result is a snapshot
      of recent routing prices, not a guaranteed future price. Providers can
      change prices, and the cheapest option at collection time may not be the
      cheapest (or even available) later.
    </p>
    <p>
      <strong>Token counts differ between models.</strong> Models can require
      different numbers of tokens to do equivalent work. Bench Bus
      intentionally uses the actual benchmark token counts for each model, so
      that difference flows into the estimated cost instead of being averaged
      away — a model that needs more tokens to reach the same score will look
      more expensive, because on this benchmark it is.
    </p>
    <p>
      <strong>A score is not a model.</strong> The Intelligence Index reduces
      each model{"'"}s quality to a single benchmark score. It measures
      performance on selected evaluations only — not helpfulness, safety,
      style, domain expertise, or fit for your workload.
    </p>
    <GeneralLimitationNote />
  </MethodologyPanel>
);

export default AaMethodologyPanel;
