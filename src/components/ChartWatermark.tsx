/**
 * A compact attribution mark that remains in screenshots of either chart.
 * The logo is decorative because the accessible name includes its meaning.
 */
export default function ChartWatermark() {
  return (
    <div
      class="mt-2 flex min-h-8 items-center justify-start gap-2 text-xs font-semibold tracking-wide text-base-content/70"
      data-testid="chart-watermark"
      role="img"
      aria-label="Bench Bus watermark, benchb.us"
    >
      <img class="h-7 w-9 object-contain" src="/logo.svg" alt="" aria-hidden="true" />
      <span>benchb.us</span>
    </div>
  );
}
