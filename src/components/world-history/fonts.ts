import localFont from "next/font/local";

/**
 * The museum's voice: an old-style serif for the chapter titles and the
 * games' quoted words, beside the site's own display and HUD fonts.
 * Cormorant Garamond's latin files are committed in src/fonts (SIL Open
 * Font License), so a build never fetches them from Google.
 */
export const historySerif = localFont({
  src: [
    { path: "../../fonts/cormorant-garamond-normal-500-700.woff2", weight: "500 700", style: "normal" },
    { path: "../../fonts/cormorant-garamond-italic-500-700.woff2", weight: "500 700", style: "italic" },
  ],
  variable: "--font-wh-serif",
  display: "swap",
  fallback: ["Georgia", "serif"],
});
