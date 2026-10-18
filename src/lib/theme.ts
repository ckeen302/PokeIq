/**
 * Light / dark theme. Dark is the default; a light choice is persisted and
 * applied as `html.light` before first paint by THEME_INIT_SCRIPT.
 */

export type Theme = "dark" | "light";

const THEME_KEY = "pokeiq-theme";
const THEME_COLORS: Record<Theme, string> = { dark: "#08071a", light: "#f6f5fc" };

/** Inline <head> script: runs before paint so a light-mode user never sees a dark flash. */
export const THEME_INIT_SCRIPT = `try{if(localStorage.getItem("${THEME_KEY}")==="light"){document.documentElement.classList.add("light");document.querySelector('meta[name="theme-color"]')?.setAttribute("content","${THEME_COLORS.light}")}}catch(e){}`;

/** Inline <head> script: show the boot splash only on the first page load of a session. */
export const SPLASH_INIT_SCRIPT = `try{if(sessionStorage.getItem("pokeiq-splash")){document.documentElement.classList.add("no-splash")}else{sessionStorage.setItem("pokeiq-splash","1")}}catch(e){document.documentElement.classList.add("no-splash")}`;

export function getTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

/** Match the browser chrome (mobile address bar) to the theme. */
export function applyThemeColor(theme: Theme): void {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

export function setTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("light", theme === "light");
  applyThemeColor(theme);
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked (private mode): the choice just won't persist.
  }
}
