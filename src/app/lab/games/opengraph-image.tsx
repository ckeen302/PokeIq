import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { gamesHubCard } from "@/lib/og/games";

/** Share card for the PokéIQ Games: the fastest Pokémon on the podium. */

export const alt = "The PokéIQ Games: real sport for every Pokémon";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return gamesHubCard();
}
