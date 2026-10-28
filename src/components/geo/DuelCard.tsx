"use client";

import { useEffect, useState } from "react";
import { Swords, Trophy } from "lucide-react";
import { DUEL_HP, type DuelMode } from "@/lib/duel-types";
import type { GeoRegionInfo, GeoRounds } from "@/lib/geo-types";
import { GEO_ERA_NAMES, type GeoEra } from "@/lib/geo-families";
import { NewDuelCard } from "@/components/duel/NewDuelCard";
import { cn } from "@/lib/utils";
import { RoundsPicker } from "./GeoSettings";
import { GeoRankedCard } from "./GeoRanked";

const MODES: { id: DuelMode; name: string }[] = [
  { id: "hp", name: "HP battle" },
  { id: "race", name: "Points race" },
];

const QUEUES = [
  { id: "casual", name: "Casual", icon: Swords },
  { id: "ranked", name: "Ranked", icon: Trophy },
] as const;
type Queue = (typeof QUEUES)[number]["id"];

/**
 * Duels on /guessr: Casual opens a duel on the chosen map (and era) for a
 * friend, or finds an opponent for the same; Ranked queues a rated
 * head-to-head on the world map (see GeoRanked.tsx).
 */
export function DuelCard({ region, era, places = Infinity }: { region: GeoRegionInfo; era?: GeoEra; places?: number }) {
  const [queue, setQueue] = useState<Queue>("casual");
  // /guessr#ranked (the ladder's link) opens on the ranked queue.
  useEffect(() => {
    if (window.location.hash === "#ranked") setQueue("ranked");
  }, []);
  const [mode, setMode] = useState<DuelMode>("hp");
  const [rounds, setRounds] = useState<GeoRounds>(5);
  const games = era ? ` · ${GEO_ERA_NAMES[era]}` : "";
  const race = mode === "race";
  const raceRounds: GeoRounds = rounds <= places ? rounds : 5;
  const toggle = (
    <div className="flex gap-1.5" role="radiogroup" aria-label="Duel queue">
      {QUEUES.map((q) => (
        <button
          key={q.id}
          type="button"
          role="radio"
          aria-checked={queue === q.id}
          onClick={() => setQueue(q.id)}
          data-testid={`geo-duel-queue-${q.id}`}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors",
            queue === q.id ? (q.id === "ranked" ? "border-warning bg-warning/15 text-foreground" : "border-screen bg-screen/15 text-foreground") : "bg-card text-muted-foreground hover:border-screen/50 hover:text-foreground"
          )}
        >
          <q.icon className="h-3.5 w-3.5" aria-hidden />
          {q.name}
        </button>
      ))}
    </div>
  );
  return (
    <div id="ranked" className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold uppercase">Duels</h2>
        {toggle}
      </div>
      {queue === "ranked" ? (
        <GeoRankedCard />
      ) : (
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
      )}
    </div>
  );
}
