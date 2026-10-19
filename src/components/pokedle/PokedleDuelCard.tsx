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
      // Matchmaking plays every generation (one queue, so it fills up); pick generations in a duel with a friend.
      match={{ game: "pokedle" }}
      heading="Head to head · Pokédle"
      blurb={`The same mystery Pokémon for both of you, ${DLE_DUEL_ROUNDS} rounds of ${DLE_MAX_GUESSES} guesses and ${DLE_DUEL_ROUND_MS / 60_000} minutes. Fewer guesses and a quicker solve score more; hints cost points. You see your opponent's colours as they guess. Send a friend the link (and pick the generations in the lobby), or find an opponent: matched duels use every generation.`}
    />
  );
}
