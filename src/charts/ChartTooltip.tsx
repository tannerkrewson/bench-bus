import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { TooltipLine } from "../charts/types";

export interface ChartTooltipProps {
  /** Pixel position of the pointer within the relatively-positioned parent. */
  left: () => number;
  top: () => number;
  title: () => string | null;
  lines: () => readonly TooltipLine[];
}

/**
 * Hover tooltip rendered as positioned DOM (not canvas) so text stays
 * selectable, zoomable, and accessible to assistive tech. It is anchored to
 * the pointer and flips sides at chart edges to avoid covering the pointer.
 */
export default function ChartTooltip(props: ChartTooltipProps) {
  let element: HTMLDivElement | undefined;
  const [position, setPosition] = createSignal({ left: 0, top: 0 });
  let frame = 0;

  const updatePosition = () => {
    if (!element) return;
    const parent = element.offsetParent as HTMLElement | null;
    const anchorLeft = props.left();
    const anchorTop = props.top();
    const gap = 14;
    const width = element.offsetWidth || 280;
    const height = element.offsetHeight || 80;
    const parentWidth = parent?.clientWidth ?? Number.POSITIVE_INFINITY;
    const parentHeight = parent?.clientHeight ?? Number.POSITIVE_INFINITY;
    const rightPosition = anchorLeft + gap;
    const leftPosition = anchorLeft - width - gap;
    const left = rightPosition + width <= parentWidth ? rightPosition : Math.max(4, leftPosition);
    const top = Math.min(
      Math.max(4, anchorTop - height / 2),
      Math.max(4, parentHeight - height - 4),
    );
    setPosition({ left, top });
  };

  createEffect(() => {
    props.title();
    props.left();
    props.top();
    props.lines();
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updatePosition);
    } else {
      updatePosition();
    }
  });

  onCleanup(() => {
    if (frame) window.cancelAnimationFrame(frame);
  });

  return (
    <Show when={props.title() !== null}>
      <div
        ref={element}
        class="pointer-events-none absolute z-10 max-w-[min(20rem,calc(100%-1rem))] rounded-box border border-base-300 bg-base-100 px-3 py-2 text-left text-base shadow-md"
        data-testid="chart-tooltip"
        role="status"
        style={{ left: `${position().left}px`, top: `${position().top}px` }}
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
