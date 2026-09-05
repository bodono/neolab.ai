import { useEffect, useState, type ReactElement } from "react";

export const THEME_STORAGE_KEY = "neolab.ai-colour-theme-v1";

type ColourTheme = "light" | "dark";

function initialTheme(): ColourTheme {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeControl({
  placement = "floating",
}: {
  readonly placement?: "floating" | "toolbar";
}): ReactElement {
  const [theme, setTheme] = useState<ColourTheme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const dark = theme === "dark";
  return (
    <button
      className={`theme-control ${placement}`}
      type="button"
      aria-pressed={dark}
      aria-label={dark ? "Use light mode" : "Use dark mode"}
      title={dark ? "Use light mode" : "Use dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      <span aria-hidden="true">{dark ? "☀" : "◐"}</span>
      {placement === "toolbar"
        ? dark
          ? "LIGHT"
          : "DARK"
        : dark
          ? "Light mode"
          : "Dark mode"}
    </button>
  );
}
