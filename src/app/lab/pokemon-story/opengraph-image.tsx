import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { storyHubCard } from "@/lib/og/pokemon-story";

/** Share card for The Story of Pokémon. */

export const alt = "The Story of Pokémon: the real history of the franchise as a 3D film, on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return storyHubCard();
}
