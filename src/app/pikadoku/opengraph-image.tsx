import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/** Share card for /pikadoku (spoiler-free: no grid, no answers). */

export const alt = "Pikadoku: Pokémon Sudoku, a Pokémon grid game";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({
    eyebrow: "Pikadoku · new grid daily",
    title: ["Pokémon", ["Sudoku", C.violet]],
    subtitle: "Fill the 3×3 grid: one Pokémon per cell that fits its row and column. Be rare to score low.",
    accent: C.violet,
    footer: "Play today's Easy, Normal or Expert grid →",
  });
}
