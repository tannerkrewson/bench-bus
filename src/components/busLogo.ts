const DRIVE_CLASS = "bench-bus-logo-drive";
const DRIVE_ANIMATION = "bench-bus-logo-drive";

/** Restart the drive-off lap on `target`, safe against rapid clicks. */
export function driveElement(target: HTMLElement): void {
  // Remove and reflow before re-adding so rapid clicks safely restart the run.
  target.classList.remove(DRIVE_CLASS);
  if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    target.style.removeProperty("transform");
    return;
  }
  void target.offsetWidth;
  target.classList.add(DRIVE_CLASS);
}

/** Drive the logo image inside the clicked button's clipped viewport. */
export function driveLogo(event: MouseEvent): void {
  const button = event.currentTarget as HTMLElement;
  const logo = button.querySelector("img");
  driveElement(logo instanceof HTMLElement ? logo : button);
}

/** Clear drive state when the lap ends; ignores unrelated animations. */
export function resetLogo(event: AnimationEvent): void {
  if (event.animationName !== DRIVE_ANIMATION || event.target !== event.currentTarget) return;
  const target = event.currentTarget as HTMLElement;
  target.classList.remove(DRIVE_CLASS);
}
