"use client";

import { useMemo } from "react";
import { DLE_MAX_GUESSES } from "@/lib/dle-types";
import { DLE_DEFAULT_ASSIST } from "@/lib/dle-assist";
import { setDlePrefs, useDlePrefs } from "@/lib/dle-local";
import { DLE_DUEL_ROUNDS, DLE_DUEL_ROUND_MS, pvpHref } from "@/lib/pvp-types";
import { NewDuelCard } from "@/components/duel/NewDuelCard";
import { AssistPicker } from "./AssistPicker";

/**
 * "Duel a friend" on /pokedle: opens a Pokédle duel and goes to its lobby.
 * The Pokédex assist level (the last one picked, solo or here) goes with
 * it: a friend's duel starts at it (the lobby can change it), and "Find an
 * opponent" only pairs trainers who picked the same one.
 */
export function PokedleDuelCard() {
  const assist = useDlePrefs()?.assist ?? DLE_DEFAULT_ASSIST;
  const match = useMemo(() => ({ game: "pokedle", assist }), [assist]);
  return (
    <NewDuelCard
      body={{ kind: "pokedle", assist }}
      href={(code) => pvpHref("pokedle", code)}
      // Matchmaking plays every generation (one queue per assist level, so it fills up); pick generations in a duel with a friend.
      match={match}
      heading="Head to head · Pokédle"
      blurb={`The same mystery Pokémon for both of you, ${DLE_DUEL_ROUNDS} rounds of ${DLE_MAX_GUESSES} guesses and ${DLE_DUEL_ROUND_MS / 60_000} minutes. Fewer guesses and a quicker solve score more; hints cost points. You see your opponent's colours as they guess. Send a friend the link (and pick the generations in the lobby), or find an opponent: matched duels use every generation and pair you with someone on the same Pokédex assist.`}
    >
      <AssistPicker value={assist} points={false} label="Pokédex assist for duels" onChange={(a) => setDlePrefs({ assist: a })} className="pt-1 [&>div]:justify-start [&>p]:text-left" />
    </NewDuelCard>
  );
}
