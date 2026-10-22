"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { CalendarDays, Trophy } from "lucide-react";
import { RANKED_PROVISIONAL_GAMES } from "@/lib/ranked";
import { useRanked } from "@/lib/ranked-client";
import { GEO_RANKED_MATCH, geoSeasonDaysLeft, geoSeasonName, geoSeasonOf } from "@/lib/geo-ranked";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { useProgress } from "@/lib/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMatchmaking } from "@/components/duel/use-matchmaking";
import { HowItWorks } from "@/components/duel/HowItWorks";
import { RankedRecord, Searching, TierBadge, TierProgress, rankedExtra } from "@/components/pokedle/Ranked";
import { useToday } from "@/lib/use-today";
import { cn } from "@/lib/utils";
import { DUEL_HP } from "@/lib/duel-types";

/** The season as this device sees it (the server rates each duel in the season it was matched in). */
function useSeason() {
  const today = useToday();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), [today]);
  return now === null ? null : { season: geoSeasonOf(now), daysLeft: geoSeasonDaysLeft(geoSeasonOf(now), now) };
}

/**
 * Ranked PokéGuessr on /guessr: this season's tier, rating, record and place
 * on the ladder, and the button that queues a head-to-head duel against
 * someone near your rating (the world map, every game).
 */
export function GeoRankedCard() {
  const { state } = useRanked({ endpoint: "/api/geo/ranked" });
  const progress = useProgress();
  const season = useSeason();
  const id = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const finder = useMatchmaking(GEO_RANKED_MATCH);

  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  const you = state.status === "ready" ? state.you : null;
  return (
    <Card className="overflow-hidden border-warning/40" data-testid="geo-ranked">
      <CardContent className={cn("grid gap-5 p-6", state.status !== "off" && "md:grid-cols-[1fr_15rem]")}>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="hud-label flex items-center gap-1.5 text-warning">
              <Trophy className="h-3.5 w-3.5" aria-hidden /> Ranked duels
            </p>
            {season && (
              <p className="hud-label flex items-center gap-1.5 text-muted-foreground" data-testid="geo-ranked-season">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Season: {geoSeasonName(season.season)} · {season.daysLeft} day{season.daysLeft === 1 ? "" : "s"} left
              </p>
            )}
          </div>
          {state.status === "loading" ? (
            <p className="text-sm text-muted-foreground">Loading your rank…</p>
          ) : state.status === "off" ? (
            <p className="text-sm text-muted-foreground">Ranked PokéGuessr opens soon. Casual duels are on: find an opponent or duel a friend below.</p>
          ) : you && you.games > 0 ? (
            <>
              <TierBadge rating={you.rating} games={you.games} size="lg" />
              <TierProgress rating={you.rating} />
              <RankedRecord you={you} />
            </>
          ) : (
            <>
              <TierBadge rating={1000} games={0} size="lg" />
              <p className="text-sm text-muted-foreground">Head-to-head on the world map. Climb from Poké Ball to Master Ball before the month is out.</p>
            </>
          )}
          {state.status !== "off" && (
            <HowItWorks
              extra={
                <Link href="/leaderboard?board=geo&format=ranked" className="font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                  Season ladder
                </Link>
              }
            >
              <p>
                A duel is the same places for you both, {DUEL_HP.toLocaleString("en-US")} HP each: every round, the lower score loses the difference. Ranked is always the whole world, every game,
                against trainers near your rating. Leaving counts as a loss.
              </p>
              <p>
                Each month is a season: everyone starts at 1,000 and climbs from Poké Ball to Master Ball. Your first {RANKED_PROVISIONAL_GAMES} games of a season move
                your rating faster.
              </p>
            </HowItWorks>
          )}
          {(error ?? finder.error) && (
            <p role="alert" className="text-sm text-destructive">
              {error ?? finder.error}
            </p>
          )}
        </div>
        {state.status !== "off" && (
          <div className="flex flex-col justify-center gap-2">
            <label htmlFor={id} className="hud-label">
              Ranked trainer name
            </label>
            <input
              id={id}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              maxLength={24}
              disabled={finder.searching}
              placeholder="Trainer name"
              data-testid="geo-ranked-name"
              className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {finder.searching ? (
              <Searching since={finder.since} onCancel={finder.cancel} ranked />
            ) : (
              <Button
                type="button"
                size="lg"
                disabled={state.status !== "ready" || !name.trim()}
                onClick={() => (isCleanName(name) ? void finder.search(name.trim(), rankedExtra()) : setError(NAME_REJECTED))}
                data-testid="geo-ranked-queue"
              >
                <Trophy className="h-4 w-4" aria-hidden /> Queue ranked
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
