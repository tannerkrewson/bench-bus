import { For, Show, createEffect } from "solid-js";
import type { TooltipLine } from "./types";

export interface ChartDetailModalProps {
  benchmarkId: string;
  open: () => boolean;
  title: () => string | null;
  lines: () => readonly TooltipLine[];
  openRouterUrl?: () => string | undefined;
  /**
   * Optional muted caveat shown under the detail rows, e.g. a note that a
   * provider's off-peak discount varies by hour (see content/discountNotes).
   */
  discountNote?: () => string | null;
  onClose: () => void;
}

/** Accessible native dialog used for the detailed model view. */
export default function ChartDetailModal(props: ChartDetailModalProps) {
  let dialog: HTMLDialogElement | undefined;
  const titleId = `chart-detail-title-${props.benchmarkId}`;

  const close = () => {
    if (dialog?.open && typeof dialog.close === "function") dialog.close();
    else props.onClose();
  };

  createEffect(() => {
    const shouldOpen = props.open();
    if (!dialog) return;
    if (shouldOpen && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!shouldOpen && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  });

  return (
    <dialog
      ref={dialog}
      class="modal"
      aria-labelledby={titleId}
      data-testid="chart-detail-modal"
      onClose={props.onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <div class="modal-box max-w-xl">
        <div>
          <h3 id={titleId} class="text-lg font-bold">{props.title()}</h3>
          <Show when={props.openRouterUrl?.()}>
            {(url) => (
              <a
                href={url()}
                class="link link-primary mt-1 inline-block text-sm"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="openrouter-link"
              >
                View on OpenRouter
              </a>
            )}
          </Show>
        </div>
        <Show when={props.title() !== null}>
          <dl class="mt-4 space-y-2 text-sm">
            <For each={props.lines()}>
              {(line) => (
                <div class="grid gap-1 sm:grid-cols-[minmax(9rem,auto)_1fr] sm:gap-4">
                  <dt class="text-base-content/70">{line.label}</dt>
                  <dd class="font-medium sm:text-right">{line.value}</dd>
                </div>
              )}
            </For>
          </dl>
          <Show when={props.discountNote?.()}>
            {(note) => (
              <p class="mt-3 text-xs text-base-content/70" data-testid="chart-detail-discount-note">
                {note()}
              </p>
            )}
          </Show>
        </Show>
        <div class="modal-action">
          <button type="button" class="btn" onClick={close}>Close</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" onClick={close}>
        <button aria-label="Close model details">close</button>
      </form>
    </dialog>
  );
}
