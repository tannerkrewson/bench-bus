const DRIVE_CLASS = "bench-bus-logo-drive";
const DRIVE_ANIMATION = "bench-bus-logo-drive";
const DRIVE_POSITION_PROPERTIES = [
  "--bench-bus-logo-left",
  "--bench-bus-logo-top",
  "--bench-bus-logo-width",
  "--bench-bus-logo-height",
] as const;

function clearDrivePosition(target: HTMLElement): void {
  DRIVE_POSITION_PROPERTIES.forEach((property) => target.style.removeProperty(property));
}

/** Restart the drive-off lap on `target`, safe against rapid clicks. */
export function driveElement(target: HTMLElement): void {
  target.classList.remove(DRIVE_CLASS);
  clearDrivePosition(target);
  if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    target.style.removeProperty("transform");
    return;
  }

  const position = target.getBoundingClientRect();
  target.style.setProperty("--bench-bus-logo-left", `${position.left}px`);
  target.style.setProperty("--bench-bus-logo-top", `${position.top}px`);
  target.style.setProperty("--bench-bus-logo-width", `${position.width}px`);
  target.style.setProperty("--bench-bus-logo-height", `${position.height}px`);

  // Remove and reflow before re-adding so rapid clicks safely restart the run.
  void target.offsetWidth;
  target.classList.add(DRIVE_CLASS);
}

/** Drive the logo image from the clicked button while its layout slot stays put. */
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
  clearDrivePosition(target);
}
