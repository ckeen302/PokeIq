"use client";

import { useMemo } from "react";
import { DLE_DEFAULT_SETTINGS, DLE_FORMAT_LABEL } from "@/lib/dle-format";
import { getDlePrefs, setDlePrefs, useDlePrefs } from "@/lib/dle-local";
import { DLE_DUEL_ROUNDS, DLE_DUEL_ROUND_MS, pvpHref } from "@/lib/pvp-types";
import { NewDuelCard } from "@/components/duel/NewDuelCard";
import { AssistPicker } from "./AssistPicker";
import { cn } from "@/lib/utils";

/**
 * "Duel a friend" on /pokedle: opens a Pokédle duel and goes to its lobby.
 * The Pokédex level and the format and settings (the last ones picked, solo
 * or here) go with it: a friend's duel starts with them (the lobby can
 * change them), and "Find an opponent" only pairs trainers who picked the
 * same Pokédex level and format (Classic or Stats, each with its
 * standard rules: few queues, so they fill up).
 */
export function PokedleDuelCard() {
  const prefs = useDlePrefs();
  const assist = prefs?.assist ?? "off";
  const settings = prefs?.settings ?? DLE_DEFAULT_SETTINGS;
  const format = settings.format === "squirdle" ? "squirdle" : "classic";
  const match = useMemo(() => ({ game: "pokedle", assist, format }), [assist, format]);
  const body = useMemo(() => ({ kind: "pokedle", assist, settings }), [assist, settings]);
  return (
    <NewDuelCard
      body={body}
      href={(code) => pvpHref("pokedle", code)}
      // Matchmaking plays every generation (one queue per level and format, so it fills up); pick generations and more in a duel with a friend.
      match={match}
      heading="Head to head · Pokédle"
      blurb={`The same mystery Pokémon for both of you, ${DLE_DUEL_ROUNDS} rounds of ${DLE_DUEL_ROUND_MS / 60_000} minutes.`}
      info={
        <>
          <p>Fewer guesses and a quicker solve score more; hints cost points. You see your opponent&apos;s colours as they guess.</p>
          <p>
            Send a friend the link, and pick the format, generations and settings in the lobby. Or find an opponent: matched duels use every generation and pair you with someone on the same
            format and Pokédex.
          </p>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <div className="flex rounded-md border border-foreground/15 p-0.5" role="radiogroup" aria-label="Duel format">
          {(["classic", "squirdle"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={format === f}
              onClick={() => setDlePrefs({ settings: { ...getDlePrefs().settings, format: f } })}
              className={cn("rounded px-2 py-1 text-xs font-semibold", format === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {DLE_FORMAT_LABEL[f]}
            </button>
          ))}
        </div>
        <AssistPicker value={assist} points={false} blurb={false} label="Pokédex assist for duels" onChange={(a) => setDlePrefs({ assist: a })} className="[&>div]:justify-start" />
      </div>
    </NewDuelCard>
  );
}
