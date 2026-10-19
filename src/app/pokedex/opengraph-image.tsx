import { C, OG_CONTENT_TYPE, OG_SIZE, TypesVisual, ogCard } from "@/lib/og/card";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { TYPE_COLORS, typeTextColor } from "@/lib/pokemon/type-colors";

/** Share card for the Pokédex and study mode. */

export const alt = "The PokéIQ Pokédex: every Pokémon, Kanto to Paldea";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  const types = Object.keys(TYPE_COLORS).map((t): [string, string, string] => [t, TYPE_COLORS[t], typeTextColor(t)]);
  return ogCard({
    eyebrow: "Pokédex · Kanto to Paldea",
    title: [`All ${POKEDEX.length.toLocaleString("en-US")}`, ["Pokémon", C.cyan]],
    subtitle: "Stats, evolutions, movesets, abilities, matchups and every Pokédex entry. Plus flashcards to learn them.",
    accent: C.cyan,
    visual: <TypesVisual colors={types} />,
    footer: "Search, filter and study →",
  });
}
