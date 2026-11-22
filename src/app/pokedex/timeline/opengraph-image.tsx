import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { timelineCard } from "@/lib/og/timeline";
import { ogT } from "@/lib/og/i18n";

/** Share card for the Pokémon Timeline. */

export const alt = "The Pokémon Timeline: Pokémon history from 1996 to today in 3D";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  return timelineCard(await ogT(props));
}
