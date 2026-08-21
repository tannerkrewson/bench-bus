import { Show } from "solid-js";
import type { TooltipLine } from "../charts/types";

export interface ChartTooltipProps {
  /** Pixel position of the cursor within the relatively-positioned parent. */
  left: () => number;
  top: () => number;
  title: () => string | null;
  lines: () => readonly TooltipLine[];
}

/**
 * Hover tooltip rendered as positioned DOM (not canvas) so text stays
 * selectable, zoomable, and accessible to assistive tech.
 */
export default function ChartTooltip(props: ChartTooltipProps) {
  return (
    <Show when={props.title() !== null}>
      <div
        class="pointer-events-none absolute z-10 max-w-xs rounded-box border border-base-300 bg-base-100 px-3 py-2 text-left text-sm shadow-md"
        data-testid="chart-tooltip"
        role="status"
        style={{
          left: `${Math.max(0, props.left() + 12)}px`,
          top: `${Math.max(0, props.top() - 8)}px`,
        }}
      >
        <div class="font-semibold">{props.title()}</div>
        <dl class="mt-1 space-y-0.5">
          {props.lines().map((line) => (
            <div class="flex justify-between gap-4">
              <dt class="text-base-content/70">{line.label}</dt>
              <dd class="font-medium">{line.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Show>
  );
}
