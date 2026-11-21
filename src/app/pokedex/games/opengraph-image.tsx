import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { videoGamesCard } from "@/lib/og/video-games";

/** Share card for the Games tab. */

export const alt = "Every Pokémon game on the PokéIQ Pokédex, with box art";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return videoGamesCard();
}
