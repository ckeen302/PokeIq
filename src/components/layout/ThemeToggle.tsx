"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyThemeColor, getTheme, setTheme, type Theme } from "@/lib/theme";
import { play } from "@/lib/sound";

/** Light / dark switch. The initial theme is applied before paint by the layout. */
export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const current = getTheme();
    setThemeState(current);
    applyThemeColor(current);
  }, []);

  function toggle() {
    const next = getTheme() === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
    play("click");
  }

  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      onClick={toggle}
      className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label={label}
      title={label}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
