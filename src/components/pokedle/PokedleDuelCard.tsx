"use client";

import { DLE_MAX_GUESSES } from "@/lib/dle-types";
import { DLE_DUEL_ROUNDS, DLE_DUEL_ROUND_MS, pvpHref } from "@/lib/pvp-types";
import { NewDuelCard } from "@/components/duel/NewDuelCard";

/** "Duel a friend" on /pokedle: opens a Pokédle duel and goes to its lobby. */
export function PokedleDuelCard() {
  return (
    <NewDuelCard
      body={{ kind: "pokedle" }}
      href={(code) => pvpHref("pokedle", code)}
      heading="Head to head · Pokédle"
      blurb={`The same mystery Pokémon for both of you, ${DLE_DUEL_ROUNDS} rounds of ${DLE_MAX_GUESSES} guesses and ${DLE_DUEL_ROUND_MS / 60_000} minutes. Fewer guesses and a quicker solve score more; hints cost points. You see your friend's colours as they guess. Send them the link and press Ready.`}
    />
  );
}
