"use client";

import { Trophy } from "lucide-react";
import type { DuelPlayerView } from "@/lib/duel-types";
import { PVP_SERIES_BEST_OF, PVP_SERIES_WINS, type PvpSeriesView } from "@/lib/pvp-types";
import { SeatDot } from "./DuelParts";
import { cn } from "@/lib/utils";

/** Rematches between the same two trainers: a best-of-three series, its score and what's next. */

/** "Game 2 · 1–0", for the HUD once a series is under way (nothing for a first game). */
export function seriesTag(series: PvpSeriesView | undefined): string | null {
  if (!series || (series.game === 1 && series.wins[0] + series.wins[1] + series.draws === 0)) return null;
  const decider = series.wins.every((w) => w === PVP_SERIES_WINS - 1) && series.winner === null;
  return `${decider ? "Decider" : `Game ${series.game}`} · ${series.wins[0]}–${series.wins[1]}`;
}

/** One trainer's games won, as filled pips out of the wins a series takes. */
function Pips({ wins, seat }: { wins: number; seat: number }) {
  return (
    <span className="flex gap-1" aria-hidden>
      {Array.from({ length: PVP_SERIES_WINS }).map((_, k) => (
        <span
          key={k}
          className={cn("h-2.5 w-6 rounded-sm border", k < wins ? "border-transparent" : "border-foreground/15 bg-foreground/5")}
          style={k < wins ? { background: seat === 0 ? "#e2306f" : "#38bdf8" } : undefined}
        />
      ))}
    </span>
  );
}

/** The series after a game: both trainers' wins, and who has taken it. */
export function SeriesScore({ series, players, you }: { series: PvpSeriesView; players: DuelPlayerView[]; you: number | null }) {
  const name = (seat: number) => (seat === you ? "You" : (players[seat]?.name ?? "They"));
  const over = series.winner !== null;
  const status = over
    ? `${name(series.winner!)} ${series.winner === you ? "take" : "takes"} the series ${series.wins[series.winner!]}–${series.wins[1 - series.winner!]}!`
    : series.wins[0] === series.wins[1]
      ? `All square. First to ${PVP_SERIES_WINS} wins takes it.`
      : `${name(series.wins[0] > series.wins[1] ? 0 : 1)} ${series.wins[0] > series.wins[1] === (you === 0) ? "lead" : "leads"}. First to ${PVP_SERIES_WINS} wins takes it.`;
  return (
    <div className={cn("space-y-3 rounded-md border px-4 py-3", over ? "border-warning/50 bg-warning/[0.06]" : "bg-shade/20")} aria-label="Series score">
      <p className="hud-label flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Trophy className={cn("h-3.5 w-3.5", over && "text-warning")} aria-hidden /> Series · best of {PVP_SERIES_BEST_OF}
        </span>
        <span>
          Game {series.game}
          {series.draws > 0 && ` · ${series.draws} draw${series.draws === 1 ? "" : "s"}`}
        </span>
      </p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {[0, 1].map((seat) => (
          <div key={seat} className={cn("flex min-w-0 flex-col gap-1.5", seat === 1 ? "order-3 items-end" : "items-start")}>
            <span className={cn("flex min-w-0 items-center gap-1.5", seat === 1 && "flex-row-reverse")}>
              <SeatDot seat={seat} />
              <span className="truncate font-display font-bold uppercase">{players[seat]?.name ?? "—"}</span>
            </span>
            <Pips wins={series.wins[seat]} seat={seat} />
          </div>
        ))}
        <span className="order-2 font-pixel text-2xl tabular-nums">
          {series.wins[0]}–{series.wins[1]}
        </span>
      </div>
      <p role="status" className={cn("text-center text-sm", over ? "font-semibold text-warning" : "text-muted-foreground")}>
        {status}
      </p>
    </div>
  );
}
