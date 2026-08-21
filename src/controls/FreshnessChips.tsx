import { For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { formatObservedUtc, SOURCE_LABELS, stalenessLabel } from "../history/resolve";
import type { SourceFreshness } from "../history/types";

/**
 * Per-source data freshness chips, e.g. "OpenRouter pricing · Aug 21, 02:00
 * UTC · last sampled 5h ago".
 *
 * Delayed or missed collection cron runs render as transparent staleness —
 * plain status wording, never error styling. Sources with no data at the
 * viewed time say so explicitly ("no data at this time") instead of implying
 * history exists.
 */
export default function FreshnessChips(props: {
  freshness: readonly SourceFreshness[];
  /** Current time for relative ages; injectable for deterministic tests. */
  now: string;
}): JSX.Element {
  return (
    <ul class="flex flex-wrap gap-2" data-testid="freshness-chips">
      <For each={props.freshness}>
        {(item) => (
          <li
            class="badge badge-ghost gap-1"
            data-testid={`freshness-${item.source}`}
            data-available={item.available ? "true" : "false"}
          >
            <span class="font-medium">{SOURCE_LABELS[item.source]}</span>
            <Show when={item.available && item.observedAt !== undefined} fallback={<span>no data at this time</span>}>
              <span>
                as of {formatObservedUtc(item.observedAt!)} · {stalenessLabel(item, props.now)}
              </span>
            </Show>
          </li>
        )}
      </For>
    </ul>
  );
}
