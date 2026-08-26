import { Info } from "lucide-solid";
import { createSignal } from "solid-js";
import type { JSX } from "solid-js";

export interface MethodologyModalProps {
  benchmarkId: string;
  title: string;
  children: JSX.Element;
}

/** Small graph-scoped native dialog with one visible close control. */
export default function MethodologyModal(props: MethodologyModalProps) {
  let dialog: HTMLDialogElement | undefined;
  const [open, setOpen] = createSignal(false);
  const dialogId = `chart-methodology-${props.benchmarkId}`;
  const titleId = `${dialogId}-title`;

  const close = () => {
    setOpen(false);
    if (!dialog) return;
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  };

  const show = () => {
    if (!dialog) return;
    setOpen(true);
    if (typeof dialog.showModal === "function") {
      try {
        dialog.showModal();
        return;
      } catch {
        // jsdom and older browsers may expose the element without showModal.
      }
    }
    dialog.setAttribute("open", "");
  };

  return (
    <>
      <button
        type="button"
        class="btn btn-outline btn-sm gap-2 whitespace-nowrap"
        aria-haspopup="dialog"
        aria-controls={dialogId}
        aria-expanded={open()}
        aria-label={props.title}
        data-testid={`methodology-button-${props.benchmarkId}`}
        onClick={show}
      >
        <Info size={16} stroke-width={2.5} aria-hidden="true" />
        <span>Methodology</span>
      </button>
      <dialog
        ref={dialog}
        id={dialogId}
        class="modal"
        aria-labelledby={titleId}
        data-testid="chart-methodology-modal"
        onClose={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
      >
        <div class="modal-box max-w-2xl">
          <h3 id={titleId} class="text-lg font-bold">{props.title}</h3>
          <div data-testid="methodology-body" class="mt-4 space-y-6 text-sm leading-relaxed text-base-content/80">
            {props.children}
          </div>
          <div class="modal-action">
            <button type="button" class="btn" onClick={close}>Close</button>
          </div>
        </div>
        <div class="modal-backdrop" aria-hidden="true" onClick={close} />
      </dialog>
    </>
  );
}
