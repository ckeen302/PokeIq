import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { gamesHubCard } from "@/lib/og/games";
import { ogT } from "@/lib/og/i18n";

/** Share card for the PokéIQ Games: the fastest Pokémon on the podium. */

export const alt = "The PokéIQ Games: real sport for every Pokémon";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  return gamesHubCard(await ogT(props));
}
