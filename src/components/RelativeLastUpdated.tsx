import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { formatLastUpdated, formatRelativeLastUpdated } from "../utils/format";

const REFRESH_INTERVAL_MS = 60 * 1000;

export interface RelativeLastUpdatedProps {
  timestamp?: () => string | null | undefined;
}

/** A shared freshness badge for chart headers. */
export default function RelativeLastUpdated(props: RelativeLastUpdatedProps) {
  const [now, setNow] = createSignal(Date.now());
  // Keep the upstream timestamp reactive even when the accessor itself is a
  // stable function prop, as it is while the async bundle changes from demo to
  // collected data.
  const timestamp = createMemo(() => props.timestamp?.() ?? null);
  const label = createMemo(() => formatRelativeLastUpdated(timestamp(), now()));
  const absolute = createMemo(() => formatLastUpdated(timestamp()));

  onMount(() => {
    const timer = window.setInterval(() => setNow(Date.now()), REFRESH_INTERVAL_MS);
    onCleanup(() => window.clearInterval(timer));
  });

  return (
    <Show when={label()}>
      <a
        href="https://github.com/tannerkrewson/bench-bus/deployments"
        target="_blank"
        rel="noopener noreferrer"
        class="badge badge-ghost whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-primary"
        data-testid="relative-last-updated"
        title={absolute() ? `Last updated ${absolute()}` : undefined}
        aria-label={absolute() ? `Last updated ${absolute()}` : undefined}
        tabindex="0"
      >
        {label()}
      </a>
    </Show>
  );
}
