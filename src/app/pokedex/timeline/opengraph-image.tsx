import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { timelineCard } from "@/lib/og/timeline";

/** Share card for the Pokémon Timeline. */

export const alt = "The Pokémon Timeline: Pokémon history from 1996 to today in 3D";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return timelineCard();
}
