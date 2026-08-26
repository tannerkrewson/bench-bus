import { driveElement, resetLogo } from "./busLogo";

/** Drive only the bus image; the benchb.us caption stays pinned in place. */
function driveWatermarkBus(event: MouseEvent): void {
  const bus = (event.currentTarget as HTMLButtonElement).querySelector("img");
  if (bus instanceof HTMLElement) driveElement(bus);
}

/** A compact, keyboard-accessible attribution control that remains in chart screenshots. */
export default function ChartWatermark() {
  return (
    <button
      type="button"
      class="mt-2 flex min-h-8 cursor-pointer appearance-none items-center justify-start gap-2 border-0 bg-transparent p-0 text-xs font-semibold tracking-wide text-base-content/70"
      data-testid="chart-watermark"
      aria-label="Bench Bus watermark, benchb.us"
      title="Bench Bus watermark, benchb.us"
      onClick={driveWatermarkBus}
    >
      <img
        class="h-7 w-9 object-contain"
        src="/logo.svg"
        alt=""
        aria-hidden="true"
        onAnimationEnd={resetLogo}
      />
      <span>benchb.us</span>
    </button>
  );
}
