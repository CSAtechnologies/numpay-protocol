import { useState, useEffect } from "react";

type Theme = "dark" | "light";

// Light is the out-of-box default. A stored choice always wins, so anyone
// already on dark stays there. The same fallback is duplicated in popup and
// approval main.tsx, which set data-theme before React mounts to avoid a
// first-paint flash; all three must agree.
export const DEFAULT_THEME: Theme = "light";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem("numpay_theme") as Theme) || DEFAULT_THEME;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("numpay_theme", theme);
  }, [theme]);

  function toggleTheme() {
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  }

  function setTheme(t: Theme) {
    setThemeState(t);
  }

  return { theme, toggleTheme, setTheme };
}
