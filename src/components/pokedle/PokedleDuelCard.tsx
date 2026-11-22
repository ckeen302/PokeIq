"use client";

import { useMemo } from "react";
import { DLE_DEFAULT_SETTINGS } from "@/lib/dle-format";
import { useT } from "@/i18n/client";
import board from "@/messages/pokedle-board";
import game from "@/messages/pokedle-game";
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
  const t = useT(game);
  const bt = useT(board);
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
      heading={t("duelCard.heading")}
      blurb={t("duelCard.blurb", { rounds: DLE_DUEL_ROUNDS, minutes: DLE_DUEL_ROUND_MS / 60_000 })}
      info={
        <>
          <p>{t("duelCard.info1")}</p>
          <p>{t("duelCard.info2")}</p>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <div className="flex rounded-md border border-foreground/15 p-0.5" role="radiogroup" aria-label={t("duelCard.format")}>
          {(["classic", "squirdle"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={format === f}
              onClick={() => setDlePrefs({ settings: { ...getDlePrefs().settings, format: f } })}
              className={cn("rounded px-2 py-1 text-xs font-semibold", format === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {bt(`format.${f}`)}
            </button>
          ))}
        </div>
        <AssistPicker value={assist} points={false} blurb={false} label={t("duelCard.assist")} onChange={(a) => setDlePrefs({ assist: a })} className="[&>div]:justify-start" />
      </div>
    </NewDuelCard>
  );
}
