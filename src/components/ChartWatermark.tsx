function driveLogo(event: MouseEvent): void {
  const logo = event.currentTarget as HTMLButtonElement;
  // Remove and reflow before re-adding so rapid clicks safely restart the run.
  logo.classList.remove("bench-bus-logo-drive");
  if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    logo.style.removeProperty("transform");
    return;
  }
  void logo.offsetWidth;
  logo.classList.add("bench-bus-logo-drive");
}

function resetLogo(event: AnimationEvent): void {
  if (event.animationName !== "bench-bus-logo-drive") return;
  const logo = event.currentTarget as HTMLButtonElement;
  logo.classList.remove("bench-bus-logo-drive");
  logo.style.removeProperty("transform");
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
      onClick={driveLogo}
      onAnimationEnd={resetLogo}
    >
      <img class="h-7 w-9 object-contain" src="/logo.svg" alt="" aria-hidden="true" />
      <span>benchb.us</span>
    </button>
  );
}
