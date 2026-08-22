import { createSignal, onCleanup, onMount } from "solid-js";
import { Dices, Moon, Palette, Sun } from "lucide-solid";

export type ThemeMode = "light" | "dark";
export type Theme =
  | "light"
  | "caramellatte"
  | "cupcake"
  | "pastel"
  | "valentine"
  | "retro"
  | "garden"
  | "lofi"
  | "fantasy"
  | "wireframe"
  | "cmyk"
  | "autumn"
  | "acid"
  | "lemonade"
  | "winter"
  | "nord"
  | "silk"
  | "emerald"
  | "corporate"
  | "bumblebee"
  | "dark"
  | "halloween"
  | "synthwave"
  | "forest"
  | "aqua"
  | "black"
  | "luxury"
  | "dracula"
  | "business"
  | "night"
  | "coffee"
  | "dim"
  | "sunset"
  | "abyss";

export const LIGHT_THEMES: readonly Theme[] = [
  "light",
  "caramellatte",
  "cupcake",
  "pastel",
  "valentine",
  "retro",
  "garden",
  "lofi",
  "fantasy",
  "wireframe",
  "cmyk",
  "autumn",
  "acid",
  "lemonade",
  "winter",
  "nord",
  "silk",
  "emerald",
  "corporate",
  "bumblebee",
];

export const DARK_THEMES: readonly Theme[] = [
  "dark",
  "halloween",
  "synthwave",
  "forest",
  "aqua",
  "black",
  "luxury",
  "dracula",
  "business",
  "night",
  "coffee",
  "dim",
  "sunset",
  "abyss",
];

export const THEME_STORAGE_KEY = "bench-bus-theme";
export const COLOR_BLIND_STORAGE_KEY = "bench-bus-color-blind";
export const COLOR_BLIND_CHANGE_EVENT = "bench-bus-color-blind-change";

export function themeMode(theme: Theme): ThemeMode {
  return DARK_THEMES.includes(theme) ? "dark" : "light";
}

/** Whether a DaisyUI theme uses the dark semantic color palette. */
export function isDarkTheme(theme: string | null | undefined): boolean {
  return theme !== null && theme !== undefined && DARK_THEMES.includes(theme as Theme);
}

/** Read the global palette preference without coupling consumers to DOM details. */
export function isColorBlindMode(value?: string | null): boolean {
  if (value !== undefined) return value === "true";
  return typeof document !== "undefined" && document.documentElement.dataset.colorBlind === "true";
}

/** Pick a theme only from the pool matching the current light/dark mode. */
export function randomThemeForMode(mode: ThemeMode, random = Math.random): Theme {
  const pool = mode === "dark" ? DARK_THEMES : LIGHT_THEMES;
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[index] as Theme;
}

function isTheme(value: string | null): value is Theme {
  return value !== null && [...LIGHT_THEMES, ...DARK_THEMES].includes(value as Theme);
}

function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "halloween"
    : "caramellatte";
}

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(value)) return value;
    // Preserve the setting from versions that stored only light/dark mode.
    if (value === "light") return "caramellatte";
    if (value === "dark") return "halloween";
  } catch {
    // Storage can be unavailable in private browsing.
  }
  return null;
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event("bench-bus-theme-change"));
}

function storedColorBlindMode(): boolean {
  try {
    return window.localStorage.getItem(COLOR_BLIND_STORAGE_KEY) === "true";
  } catch {
    // Storage can be unavailable in private browsing.
  }
  return false;
}

function applyColorBlindMode(enabled: boolean): void {
  if (enabled) document.documentElement.dataset.colorBlind = "true";
  else delete document.documentElement.dataset.colorBlind;
  window.dispatchEvent(new Event(COLOR_BLIND_CHANGE_EVENT));
}

/** Light/dark switch, color-blind palette toggle, and a mode-aware dice picker. */
export default function ThemeToggle() {
  const [theme, setTheme] = createSignal<Theme>("caramellatte");
  const [colorBlind, setColorBlind] = createSignal(false);
  let media: MediaQueryList | undefined;
  let onSystemThemeChange: ((event: MediaQueryListEvent) => void) | undefined;

  onMount(() => {
    media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const saved = storedTheme();
    const initial = saved ?? systemTheme();
    setTheme(initial);
    applyTheme(initial);
    const initialColorBlind = storedColorBlindMode();
    setColorBlind(initialColorBlind);
    applyColorBlindMode(initialColorBlind);

    if (!saved && media) {
      onSystemThemeChange = () => {
        const next = systemTheme();
        setTheme(next);
        applyTheme(next);
      };
      media.addEventListener?.("change", onSystemThemeChange);
    }
  });

  onCleanup(() => {
    if (media && onSystemThemeChange) {
      media.removeEventListener?.("change", onSystemThemeChange);
    }
  });

  const persist = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing or disabled storage should not block theme controls.
    }
  };

  const toggle = () => {
    const nextMode: ThemeMode = themeMode(theme()) === "dark" ? "light" : "dark";
    persist(nextMode === "dark" ? "halloween" : "caramellatte");
    if (media && onSystemThemeChange) {
      media.removeEventListener?.("change", onSystemThemeChange);
    }
    media = undefined;
    onSystemThemeChange = undefined;
  };

  const randomize = () => persist(randomThemeForMode(themeMode(theme())));
  const modeLabel = () => themeMode(theme());
  const toggleColorBlind = () => {
    const next = !colorBlind();
    setColorBlind(next);
    applyColorBlindMode(next);
    try {
      window.localStorage.setItem(COLOR_BLIND_STORAGE_KEY, String(next));
    } catch {
      // Private browsing or disabled storage should not block theme controls.
    }
  };

  return (
    <div class="join" role="group" aria-label="Theme controls">
      <button
        type="button"
        class="btn btn-sm btn-outline btn-square join-item"
        aria-label={`Switch to ${modeLabel() === "dark" ? "light" : "dark"} mode`}
        title="Toggle light/dark mode"
        onClick={toggle}
      >
        {modeLabel() === "dark" ? <Sun aria-hidden="true" size={17} /> : <Moon aria-hidden="true" size={17} />}
      </button>
      <button
        type="button"
        role="switch"
        class={`btn btn-sm btn-square join-item ${colorBlind() ? "btn-primary" : "btn-outline"}`}
        aria-checked={colorBlind()}
        aria-label={`${colorBlind() ? "Disable" : "Enable"} color-blind mode`}
        title={`${colorBlind() ? "Disable" : "Enable"} color-blind mode`}
        data-testid="color-blind-toggle"
        onClick={toggleColorBlind}
      >
        <Palette aria-hidden="true" size={17} />
      </button>
      <button
        type="button"
        class="btn btn-sm btn-outline btn-square join-item"
        data-testid="random-theme"
        aria-label={`Choose a random ${modeLabel()} theme`}
        title={`Choose a random ${modeLabel()} theme`}
        onClick={randomize}
      >
        <Dices aria-hidden="true" size={17} />
      </button>
    </div>
  );
}
