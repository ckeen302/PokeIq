import { Cormorant_Garamond } from "next/font/google";

/**
 * The museum's voice: an old-style serif for the chapter titles and the
 * games' quoted words, beside the site's own display and HUD fonts.
 */
export const historySerif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-wh-serif",
  display: "swap",
});
