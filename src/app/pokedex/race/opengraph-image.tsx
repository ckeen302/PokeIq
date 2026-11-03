import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { racePresetCard } from "@/lib/og/race";

/** Share card for Pokémon Race: the fastest eight at the line. */

export const alt = "The fastest Pokémon racing 100 m on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return racePresetCard();
}
