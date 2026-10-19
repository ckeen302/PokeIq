import { C, ClueTilesVisual, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/** Share card for /pokedle (spoiler-free: the board's colours only). */

export const alt = "Pokédle: guess the mystery Pokémon";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({
    eyebrow: "Pokédle · new Pokémon daily",
    title: ["Guess the", ["mystery", C.violet], ["Pokémon", C.violet]],
    subtitle: "Eight guesses. Every one shows type, generation, size and colour clues.",
    accent: C.violet,
    visual: <ClueTilesVisual />,
    footer: "Play today's, or duel a stranger live →",
  });
}
