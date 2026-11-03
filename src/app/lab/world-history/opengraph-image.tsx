import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { historyHubCard } from "@/lib/og/world-history";
import { CHAPTERS } from "@/lib/world-history/data";

/** Share card for The History of the Pokémon World. */

export const alt = "The History of the Pokémon World: a 3D museum of the in-universe story, on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return historyHubCard(CHAPTERS);
}
