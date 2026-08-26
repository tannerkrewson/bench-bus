import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { formatLastUpdated, formatRelativeLastUpdated } from "../utils/format";

const REFRESH_INTERVAL_MS = 60 * 1000;

export interface RelativeLastUpdatedProps {
  timestamp?: () => string | null | undefined;
}

/** A shared freshness badge for chart headers. */
export default function RelativeLastUpdated(props: RelativeLastUpdatedProps) {
  const [now, setNow] = createSignal(Date.now());

  onMount(() => {
    const timer = window.setInterval(() => setNow(Date.now()), REFRESH_INTERVAL_MS);
    onCleanup(() => window.clearInterval(timer));
  });

  return (
    <Show when={formatRelativeLastUpdated(props.timestamp?.() ?? null, now())}>
      {(label) => {
        const absolute = formatLastUpdated(props.timestamp?.() ?? null);
        return (
          <a
            href="https://github.com/tannerkrewson/bench-bus/deployments"
            target="_blank"
            rel="noopener noreferrer"
            class="badge badge-ghost whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-primary"
            data-testid="relative-last-updated"
            title={absolute ? `Last updated ${absolute}` : undefined}
            aria-label={absolute ? `Last updated ${absolute}` : undefined}
            tabindex="0"
          >
            {label()}
          </a>
        );
      }}
    </Show>
  );
}
