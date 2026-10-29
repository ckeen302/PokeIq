"use client";

import { Swords } from "lucide-react";
import type { DuelView } from "@/lib/duel-types";
import { geoDivisionOf } from "@/lib/geo-ranked";
import { VersusIntro, useVersusStats, type VersusSide } from "@/components/duel/VersusIntro";
import { GeoBallIcon, GeoDivisionBadge, GymLeaderAvatar, GymLeaderTag } from "./GeoRanked";
import { THEM_COLOR, YOU_COLOR } from "./DuelHud";

/**
 * A PokéGuessr duel's versus screen (casual and ranked), before round 1:
 * you on the left, your opponent on the right, each with their public duel
 * record from /api/geo/duel-stats. The Gym Leader bot has no record.
 */
export function GeoVersus({ view, me, secondsLeft, mapName }: { view: DuelView; me: number; secondsLeft: number; mapName: string }) {
  const seats = [me, 1 - me];
  const players = seats.map((s) => view.players[s]);
  const stats = useVersusStats(
    "/api/geo/duel-stats",
    players.map((p) => (p && !p.bot ? p.name : null))
  );
  const mult = view.round?.multiplier ?? 1;
  const side = (seat: number, i: number): VersusSide => {
    const p = view.players[seat];
    return {
      name: p?.name ?? "—",
      you: seat === me,
      avatar: p?.avatar ?? null,
      figure: p?.bot ? <GymLeaderAvatar name={p.name} size={136} /> : undefined,
      tag: p?.bot ? <GymLeaderTag /> : undefined,
      badge: view.ranked ? <GeoDivisionBadge elo={view.ranked.elos[seat]} size="sm" className="[&_span]:!text-white/90" /> : undefined,
      stats: p?.bot ? null : stats[i],
      accent: seat === me ? YOU_COLOR : THEM_COLOR,
    };
  };
  return (
    <VersusIntro
      testId="geo-versus"
      left={side(seats[0], 0)}
      right={side(seats[1], 1)}
      title="Round 1"
      icon={view.ranked ? <GeoBallIcon division={geoDivisionOf(view.ranked.elos[me]).id} className="h-9 w-9 drop-shadow-lg sm:h-12 sm:w-12" /> : <Swords className="h-7 w-7 sm:h-10 sm:w-10" aria-hidden />}
      subtitle={
        <>
          {view.ranked ? "Ranked · " : ""}
          {view.mode === "race" ? "Points race" : mult > 1 ? `${mult}× damage` : "HP battle"}
          {view.turbo ? " · Turbo" : ""}
        </>
      }
      detail={mapName}
      countdown={
        <span key={secondsLeft} className="geo-digit font-display text-6xl font-extrabold leading-none sm:text-8xl" data-testid="geo-intro-digit">
          {secondsLeft}
        </span>
      }
    />
  );
}
