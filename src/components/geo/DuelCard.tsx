"use client";

import { useState } from "react";
import { DUEL_HP, type DuelMode } from "@/lib/duel-types";
import type { GeoRegionInfo, GeoRounds } from "@/lib/geo-types";
import { GEO_ERA_NAMES, type GeoEra } from "@/lib/geo-families";
import { NewDuelCard } from "@/components/duel/NewDuelCard";
import { cn } from "@/lib/utils";
import { RoundsPicker } from "./GeoSettings";

const MODES: { id: DuelMode; name: string }[] = [
  { id: "hp", name: "HP battle" },
  { id: "race", name: "Points race" },
];

/** "Duel a friend" on /guessr: opens a duel on the chosen map (and era) and goes to its lobby. */
export function DuelCard({ region, era, places = Infinity }: { region: GeoRegionInfo; era?: GeoEra; places?: number }) {
  const [mode, setMode] = useState<DuelMode>("hp");
  const [rounds, setRounds] = useState<GeoRounds>(5);
  const games = era ? ` · ${GEO_ERA_NAMES[era]}` : "";
  const race = mode === "race";
  const raceRounds: GeoRounds = rounds <= places ? rounds : 5;
  return (
    <NewDuelCard
      endpoint="/api/geo/duel"
      body={{ region: region.id, ...(era ? { era } : {}), mode, ...(race ? { rounds: raceRounds } : {}) }}
      // Quick matching pairs HP battles only.
      match={race ? undefined : { game: "geo", region: region.id, ...(era ? { era } : {}) }}
      href={(code) => `/guessr/duel/${code}`}
      heading={`Head to head · ${region.name}${games}`}
      blurb={
        race
          ? `The same ${raceRounds} places for both of you, on the map${era ? " and games" : ""} picked above. Whoever scores the most points over ${raceRounds} rounds wins. Send your friend the link and press Ready.`
          : `The same places for both of you, on the map${era ? " and games" : ""} picked above. ${DUEL_HP.toLocaleString("en-US")} HP each: every round, the lower score loses the difference. Send your friend the link and press Ready.`
      }
    >
      <div className="space-y-2 pt-1">
        <div className="space-y-1.5">
          <p className="hud-label">Mode</p>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Duel mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                onClick={() => setMode(m.id)}
                data-testid={`geo-duel-mode-${m.id}`}
                className={cn(
                  "rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors",
                  mode === m.id ? "border-screen bg-screen/15 text-foreground" : "bg-card text-muted-foreground hover:border-screen/50 hover:text-foreground"
                )}
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>
        {race && <RoundsPicker value={raceRounds} onChange={setRounds} max={places} testId="geo-duel-rounds" label="Rounds in the race" />}
      </div>
    </NewDuelCard>
  );
}
