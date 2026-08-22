import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import ThemeToggle, {
  DARK_THEMES,
  LIGHT_THEMES,
  COLOR_BLIND_STORAGE_KEY,
  THEME_STORAGE_KEY,
  isColorBlindMode,
  isDarkTheme,
  randomThemeForMode,
  themeMode,
} from "./ThemeToggle";
import type { Theme } from "./ThemeToggle";

afterEach(() => {
  window.localStorage.removeItem(THEME_STORAGE_KEY);
  window.localStorage.removeItem(COLOR_BLIND_STORAGE_KEY);
  document.documentElement.dataset.theme = "";
  delete document.documentElement.dataset.colorBlind;
  vi.restoreAllMocks();
});

describe("ThemeToggle", () => {
  it("exposes the theme buttons as a labeled keyboard-accessible group", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ThemeToggle />, container);
    const group = container.querySelector("[role='group'][aria-label='Theme controls']");
    expect(group).not.toBeNull();
    expect(group?.querySelectorAll("button")).toHaveLength(3);
    const toggle = group?.querySelector("[data-testid='color-blind-toggle']");
    expect(toggle?.getAttribute("role")).toBe("switch");
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    dispose();
    container.remove();
  });

  it("toggles and persists color-blind mode while announcing the global change", async () => {
    const events: Event[] = [];
    const onChange = (event: Event) => events.push(event);
    window.addEventListener("bench-bus-color-blind-change", onChange);
    window.localStorage.setItem(COLOR_BLIND_STORAGE_KEY, "true");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ThemeToggle />, container);
    await vi.waitFor(() => expect(isColorBlindMode()).toBe(true));
    const toggle = container.querySelector("[data-testid='color-blind-toggle']") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    toggle.click();
    expect(isColorBlindMode()).toBe(false);
    expect(window.localStorage.getItem(COLOR_BLIND_STORAGE_KEY)).toBe("false");
    expect(events).toHaveLength(2);
    window.removeEventListener("bench-bus-color-blind-change", onChange);
    dispose();
    container.remove();
  });

  it("uses caramellatte for a fresh light preference", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ThemeToggle />, container);
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe("caramellatte"));
    dispose();
    container.remove();
  });

  it("uses halloween for a fresh dark preference", async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = (() => ({
      matches: true,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ThemeToggle />, container);
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe("halloween"));
    dispose();
    container.remove();
    window.matchMedia = originalMatchMedia;
  });

  it("shares the complete dark-theme definition with chart styling", () => {
    for (const theme of DARK_THEMES) expect(isDarkTheme(theme)).toBe(true);
    for (const theme of LIGHT_THEMES) expect(isDarkTheme(theme)).toBe(false);
    expect(isDarkTheme("unknown-theme")).toBe(false);
  });

  it("selects only from the matching random theme pool", () => {
    expect(LIGHT_THEMES).toContain(randomThemeForMode("light", () => 0));
    expect(LIGHT_THEMES).toContain(randomThemeForMode("light", () => 0.999));
    expect(DARK_THEMES).toContain(randomThemeForMode("dark", () => 0));
    expect(DARK_THEMES).toContain(randomThemeForMode("dark", () => 0.999));
  });

  it("keeps dark mode while randomizing a dark theme", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "halloween");
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ThemeToggle />, container);

    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe("halloween"));
    (container.querySelector("button[data-testid='random-theme']") as HTMLButtonElement).click();
    expect(themeMode(document.documentElement.dataset.theme as Theme)).toBe("dark");
    expect(DARK_THEMES).toContain(document.documentElement.dataset.theme);
    expect(container.querySelector("button[data-testid='random-theme']")?.getAttribute("aria-label")).toContain(
      "dark",
    );

    dispose();
    container.remove();
  });
});
