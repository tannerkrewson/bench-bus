import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import ThemeToggle, {
  DARK_THEMES,
  LIGHT_THEMES,
  THEME_STORAGE_KEY,
  randomThemeForMode,
  themeMode,
} from "./ThemeToggle";
import type { Theme } from "./ThemeToggle";

afterEach(() => {
  window.localStorage.removeItem(THEME_STORAGE_KEY);
  document.documentElement.dataset.theme = "";
  vi.restoreAllMocks();
});

describe("ThemeToggle", () => {
  it("uses caramellatte for a fresh light preference and halloween for dark", () => {
    expect(themeMode("caramellatte")).toBe("light");
    expect(themeMode("halloween")).toBe("dark");
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
