import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { racePresetCard } from "@/lib/og/race";
import { ogT } from "@/lib/og/i18n";

/** Share card for Pokémon Race: the fastest eight at the line. */

export const alt = "The fastest Pokémon racing 100 m on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  return racePresetCard(undefined, undefined, undefined, await ogT(props));
}
