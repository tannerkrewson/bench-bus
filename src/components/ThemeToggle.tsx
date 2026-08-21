import { createSignal, onCleanup, onMount } from "solid-js";

type Theme = "light" | "dark";
const THEME_STORAGE_KEY = "bench-bus-theme";

function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event("bench-bus-theme-change"));
}

/** Light/dark switch. With no saved choice, follows the operating-system theme. */
export default function ThemeToggle() {
  const [theme, setTheme] = createSignal<Theme>("light");
  let media: MediaQueryList | undefined;
  let onSystemThemeChange: ((event: MediaQueryListEvent) => void) | undefined;

  onMount(() => {
    media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const saved = storedTheme();
    const initial = saved ?? systemTheme();
    setTheme(initial);
    applyTheme(initial);

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

  const toggle = () => {
    const next: Theme = theme() === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing or disabled storage should not block the toggle.
    }
    if (media && onSystemThemeChange) {
      media.removeEventListener?.("change", onSystemThemeChange);
    }
    media = undefined;
    onSystemThemeChange = undefined;
  };

  return (
    <button
      type="button"
      class="btn btn-sm btn-outline"
      aria-label={`Switch to ${theme() === "dark" ? "light" : "dark"} mode`}
      title="Toggle light/dark mode"
      onClick={toggle}
    >
      {theme() === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
