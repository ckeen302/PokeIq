/**
 * A first visit's "How to play" in the page's HTML.
 *
 * Connections and Pikadoku open How to play by themselves on a first visit.
 * Opened from the page's scripts, it waited for them to download and run
 * (about two and a half seconds on a desktop's first visit) and was then
 * the page's largest paint. Now the game renders it with the board, hidden
 * (`.howto-ssr` in globals.css), and an inline script that runs before the
 * first paint shows it (`html.howto-first`) when the device has no sign of
 * an earlier visit. When the game's own check has run, the same element
 * stays as the open pop-up (nothing on screen changes) or goes away.
 *
 * As the opened pop-up does, it puts the focus on its close button (as soon
 * as the page is parsed), so the focus ring doesn't appear later on.
 *
 * Desktop widths only, and not under reduced motion: on a phone the pop-up
 * is a bottom sheet that slides in once the game has decided, as before.
 */

export const HOWTO_FIRST_CLASS = "howto-first";

/** The width from which the pop-up is a centred dialog (Tailwind's md, as in Sheet). */
const DESKTOP = "(min-width: 768px)";

/**
 * The inline script: `firstVisit` is a JavaScript expression over `P` (the
 * game's saved settings, parsed) and `G` (the progress record, parsed) that
 * mirrors the game's own first-visit check.
 */
export function howToFirstScript(prefsKey: string, firstVisit: string): string {
  return `try{if(matchMedia(${JSON.stringify(DESKTOP)}).matches&&!matchMedia("(prefers-reduced-motion: reduce)").matches){var P=JSON.parse(localStorage.getItem(${JSON.stringify(prefsKey)})||"{}")||{},G=JSON.parse(localStorage.getItem("pokeiq:progress:v1")||"{}")||{};if(${firstVisit}){document.documentElement.classList.add(${JSON.stringify(HOWTO_FIRST_CLASS)});document.addEventListener("DOMContentLoaded",function(){var b=document.querySelector('.howto-ssr [aria-label="Close"]');b&&b.focus()})}}}catch(e){}`;
}

/** Whether the inline script showed the page's copy before the game's scripts ran. */
export function howToShownEarly(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains(HOWTO_FIRST_CLASS);
}

/** Once the game has decided: the page's copy is the game's to show or hide from here on. */
export function releaseHowToFirst(): void {
  document.documentElement.classList.remove(HOWTO_FIRST_CLASS);
}
