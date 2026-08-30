import { For, Show } from "solid-js";
import type { ChartSourceLink, ChartSubtitle } from "../charts/types";
import { chartSubtitleLinks } from "./ChartSubtitle";

export interface ChartSourcesProps {
  benchmarkId: string;
  content: ChartSubtitle;
  sourceLinks?: readonly ChartSourceLink[];
}

/** Accessible source navigation built only from verified source-link metadata. */
export default function ChartSources(props: ChartSourcesProps) {
  const links = () => props.sourceLinks ?? chartSubtitleLinks(props.content);
  const titleId = `chart-sources-${props.benchmarkId}`;

  return (
    <Show when={links().length > 0}>
      <nav
        class="mt-4 flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 border-t border-base-300 pt-3 text-sm text-base-content/70"
        aria-labelledby={titleId}
        data-testid="chart-sources"
      >
        <h3 id={titleId} class="font-medium text-base-content">Sources:</h3>
        <ul class="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <For each={links()}>
            {(link) => (
              <li>
                <a
                  class="link link-hover"
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {link.label}
                </a>
              </li>
            )}
          </For>
        </ul>
      </nav>
    </Show>
  );
}
