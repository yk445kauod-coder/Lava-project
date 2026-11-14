import { useCallback, useEffect, useState } from "react";

import { applyTheme, readTheme, toggleTheme, type Theme } from "./storage";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Theme state synced to `<html data-theme>` and `lava.theme`. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = readTheme();
    return stored === "dark" || stored === "light" ? stored : systemTheme();
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setThemeState(toggleTheme());
  }, []);

  return { theme, toggle };
}
