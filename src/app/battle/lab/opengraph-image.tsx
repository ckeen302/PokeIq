import { C, OG_CONTENT_TYPE, OG_SIZE, WinOddsVisual, ogCard } from "@/lib/og/card";

/** Share card for the Battle Lab. */

export const alt = "Battle Lab: Pokémon win odds from thousands of simulated battles";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({
    eyebrow: "Battle Lab",
    title: ["Who wins,", ["and how often?", C.cyan]],
    subtitle: "Set up any matchup, Gen 1 to 9, and Showdown's engine plays it thousands of times in your browser.",
    accent: C.cyan,
    visual: <WinOddsVisual />,
    footer: "Win odds with a 95% confidence interval →",
  });
}
