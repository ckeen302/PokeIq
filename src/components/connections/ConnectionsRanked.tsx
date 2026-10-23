"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { Flame, Loader2, Trophy } from "lucide-react";
import { RANKED_PROVISIONAL_GAMES } from "@/lib/ranked";
import { CONN_RANKED_MATCH, connSeasonLabel } from "@/lib/connections/ranked";
import { useConnRanked } from "@/lib/connections/ranked-client";
import type { ConnDuelView } from "@/lib/pvp-types";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { useProgress } from "@/lib/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMatchmaking } from "@/components/duel/use-matchmaking";
import { HowItWorks } from "@/components/duel/HowItWorks";
import { RatingChange, Searching, TierBadge, TierProgress, rankedExtra } from "@/components/pokedle/Ranked";
import { cn } from "@/lib/utils";

const fmt = (n: number) => n.toLocaleString("en-US");

/** The days left in a season, as "12 days left". */
function daysLeft(endsAt: number): string {
  const days = Math.max(0, Math.ceil((endsAt - Date.now()) / 86_400_000));
  return days <= 1 ? "ends today" : `${days} days left`;
}

/**
 * Ranked on /connections: your tier, rating and place this season, and the
 * button that queues you for a ranked race against someone near your rating.
 */
export function ConnectionsRankedCard() {
  const { state } = useConnRanked();
  const progress = useProgress();
  const id = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const finder = useMatchmaking(CONN_RANKED_MATCH);

  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);

  if (state.status === "off") return null;
  const you = state.status === "ready" ? state.you : null;
  return (
    <Card className="overflow-hidden border-warning/40" data-testid="conn-ranked-card">
      <CardContent className="grid gap-5 p-6 md:grid-cols-[1fr_15rem]">
        <div className="min-w-0 space-y-3">
          <p className="hud-label flex items-center gap-1.5 text-warning">
            <Trophy className="h-3.5 w-3.5" aria-hidden /> Ranked · PokéConnections
            {state.status === "ready" && (
              <span className="text-muted-foreground">
                {" "}
                · {connSeasonLabel(state.season)} season, {daysLeft(state.endsAt)}
              </span>
            )}
          </p>
          {state.status === "loading" ? (
            <p className="text-sm text-muted-foreground">Loading your rank…</p>
          ) : you ? (
            <>
              <TierBadge rating={you.rating} games={you.games} size="lg" />
              <TierProgress rating={you.rating} />
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>
                  {you.wins}W · {you.losses}L · {you.draws}D
                </span>
                {you.position !== null && (
                  <span>
                    Ladder <b className="text-foreground">#{fmt(you.position)}</b> of {fmt(you.players)}
                  </span>
                )}
                {you.streak > 1 && (
                  <span className="flex items-center gap-1 font-semibold text-warning">
                    <Flame className="h-4 w-4" aria-hidden /> {you.streak} wins in a row
                  </span>
                )}
              </p>
            </>
          ) : (
            <>
              <TierBadge rating={1000} games={0} size="lg" />
              <p className="text-sm text-muted-foreground">Race trainers near your rating and climb from Poké Ball to Master Ball.</p>
            </>
          )}
          <HowItWorks
            extra={
              <Link href="/leaderboard?board=connections-ranked" className="font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                Ranked board
              </Link>
            }
          >
            <p>
              The same race as a casual duel, rated like ranked Pokédle: everyone starts each season at 1,000, your first {RANKED_PROVISIONAL_GAMES} games move your rating faster,
              and the ladder starts over every month.
            </p>
            <p>Leaving a race counts as a loss.</p>
          </HowItWorks>
          {(error ?? finder.error) && (
            <p role="alert" className="text-sm text-destructive">
              {error ?? finder.error}
            </p>
          )}
        </div>
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
              data-testid="conn-ranked-queue"
            >
              <Trophy className="h-4 w-4" aria-hidden /> Queue ranked
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** After a ranked race: the rating change once it has been counted. */
export function ConnRankedOutcome({ view }: { view: ConnDuelView }) {
  const me = view.you!;
  const result = view.ranked?.result;
  const { reload } = useConnRanked({ enabled: !!result });
  useEffect(() => {
    if (result) reload();
  }, [result, reload]);
  if (!view.ranked) return null;
  if (!result) {
    return (
      <p className={cn("flex items-center justify-center gap-2 text-sm text-muted-foreground")} role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Counting your rating…
      </p>
    );
  }
  return (
    <div className="space-y-2" data-testid="conn-ranked-outcome">
      <RatingChange before={result.before[me]} after={result.after[me]} provisional={view.ranked.provisional[me]} />
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/leaderboard?board=connections-ranked" className="underline underline-offset-2 hover:text-foreground">
          Ranked board
        </Link>{" "}
        · {connSeasonLabel(view.ranked.season)}
      </p>
    </div>
  );
}
