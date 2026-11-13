"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Sheet } from "@/components/pokedle/sheets";
import { cn } from "@/lib/utils";
import { iconButton } from "./parts";
import type { PdkDifficulty } from "@/lib/pikadoku/types";
import type { PdkPlay, PdkRecord } from "@/lib/pikadoku/play";
import { archiveDates, archiveKey, archiveMonths, monthGrid } from "@/lib/pikadoku/archive";
import { CONN_LAUNCH_DATE, connNumber } from "@/lib/connections/types";
import { NextPuzzleCountdown } from "./results";

/** Pikadoku's pop-up sheets: stats and the archive. How to play is in howto-sheet.tsx. */

/** Streak, totals, how full your daily grids get, your rarest daily and when the next one lands. */
export function PdkStatsSheet({ streak, best, play, results, onClose }: { streak: number; best: number; play: PdkPlay; results: Readonly<Record<string, PdkRecord>>; onClose: () => void }) {
  const cell = (label: string, value: number | string) => (
    <div className="rounded-md border border-foreground/10 p-3 text-center">
      <p className="font-display text-2xl font-bold tabular-nums">{value}</p>
      <p className="hud-label">{label}</p>
    </div>
  );
  // Daily games finished on this device (Normal and the other difficulties).
  const done = Object.values(results).filter((r) => r.over);
  const dist = Array.from({ length: 10 }, (_, n) => done.filter((r) => r.solved === n).length);
  const top = Math.max(1, ...dist);
  const scores = done.map((r) => r.score).filter((x): x is number => x !== null && x !== undefined);
  const rarest = scores.length ? Math.min(...scores) : null;
  return (
    <Sheet title="Statistics" onClose={onClose}>
      <div className="space-y-4" data-testid="pdk-stats">
        <div className="grid grid-cols-3 gap-2">
          {cell("Played", play.games)}
          {cell("Perfect %", play.games ? Math.round((play.wins / play.games) * 100) : 0)}
          {cell("Rarest daily", rarest ?? "–")}
          {cell("Current streak", streak)}
          {cell("Best streak", best)}
          {cell("Duels won", `${play.duelWins}–${play.duelLosses}`)}
        </div>
        <div>
          <p className="hud-label mb-1.5">Cells filled in your dailies</p>
          {done.length === 0 ? (
            <p className="text-sm text-muted-foreground">Finish a daily to see how full your grids get.</p>
          ) : (
            <ol className="space-y-1" data-testid="pdk-distribution">
              {dist
                .map((n, solved) => ({ n, solved }))
                .reverse()
                .filter(({ solved, n }) => solved >= 1 || n > 0)
                .map(({ n, solved }) => (
                  <li key={solved} className="flex items-center gap-2 text-xs">
                    <span className="w-7 shrink-0 text-right font-semibold tabular-nums">{solved}/9</span>
                    <span className="h-4 rounded-sm bg-primary/70 px-1 text-right font-bold leading-4 text-primary-foreground" style={{ width: `${Math.max(8, (n / top) * 100)}%` }}>
                      {n}
                    </span>
                  </li>
                ))}
            </ol>
          )}
        </div>
        <NextPuzzleCountdown className="text-center" />
      </div>
    </Sheet>
  );
}

const ARCHIVE_DIFFS: { id: PdkDifficulty; label: string }[] = [
  { id: "easy", label: "Easy" },
  { id: "normal", label: "Normal" },
  { id: "expert", label: "Expert" },
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthName = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const status = (r: PdkRecord | undefined) => (!r ? "" : r.over ? `${r.solved}/9` : r.guesses.length ? "…" : "");

/**
 * Every daily as a calendar, with how you did on each (your daily result
 * where you played it on the day, else your archive game). Pick a day, then a
 * difficulty. Archive games never reach the board, the streak or the daily results.
 */
export function PdkArchiveSheet({
  today,
  archive,
  results,
  onPlay,
  onToday,
  onClose,
}: {
  today: string;
  archive: Readonly<Record<string, PdkRecord>>;
  /** This device's dailies, played on the day (Normal keyed by date, others "date:difficulty"). */
  results: Readonly<Record<string, PdkRecord>>;
  onPlay: (date: string, difficulty: PdkDifficulty) => void;
  onToday: (difficulty: PdkDifficulty) => void;
  onClose: () => void;
}) {
  const months = archiveMonths(today);
  const [month, setMonth] = useState(months[months.length - 1]);
  const past = archiveDates(today);
  const [picked, setPicked] = useState<string>(past[0] ?? today);
  const recordFor = (date: string, d: PdkDifficulty) => results[d === "normal" ? date : `${date}:${d}`] ?? archive[archiveKey(date, d)];
  const mi = months.indexOf(month);
  const playable = (d: string) => d >= CONN_LAUNCH_DATE && d <= today;
  return (
    <Sheet title="Archive" onClose={onClose}>
      <p className="mb-3 text-sm text-muted-foreground">Play any past daily at any difficulty. Archive games are just for fun: they never count toward the daily board or your streak.</p>
      <div className="space-y-3" data-testid="pdk-archive-calendar">
        <div className="flex items-center justify-between">
          <button type="button" className={iconButton} onClick={() => setMonth(months[mi - 1])} disabled={mi <= 0} aria-label="Previous month">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <p className="font-display text-lg font-bold uppercase" aria-live="polite">
            {monthName(month)}
          </p>
          <button type="button" className={iconButton} onClick={() => setMonth(months[mi + 1])} disabled={mi >= months.length - 1} aria-label="Next month">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label={`Dailies in ${monthName(month)}`}>
          {WEEKDAYS.map((w) => (
            <span key={w} className="hud-label py-1" aria-hidden>
              {w}
            </span>
          ))}
          {monthGrid(month).map((d, i) => {
            if (!d) return <span key={i} />;
            const open = playable(d);
            const r = recordFor(d, "normal");
            const s = status(r);
            return (
              <button
                key={d}
                type="button"
                role="gridcell"
                disabled={!open}
                aria-selected={picked === d}
                aria-label={`${d}${d === today ? " (today)" : ""}${s ? `: ${s === "…" ? "in progress" : `${s} cells`}` : ""}`}
                onClick={() => setPicked(d)}
                data-testid={`pdk-cal-${d}`}
                className={cn(
                  "flex aspect-square min-w-0 flex-col items-center justify-center rounded-md border text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:border-transparent disabled:text-muted-foreground/40",
                  picked === d ? "border-primary bg-primary/15" : "border-foreground/10 hover:border-primary",
                  r?.over && r.won && picked !== d && "border-success/60 bg-success/15",
                  d === today && "font-bold"
                )}
              >
                <span className="tabular-nums leading-none">{Number(d.slice(8))}</span>
                <span className="mt-0.5 h-3 text-[10px] font-semibold leading-3 tabular-nums text-muted-foreground">{s}</span>
              </button>
            );
          })}
        </div>
        <div className="rounded-md border border-foreground/15 p-3" data-testid="pdk-archive-day">
          <p className="mb-2 text-sm font-semibold">
            #{connNumber(picked)} <span className="font-normal text-muted-foreground">· {picked}{picked === today ? " · today's daily" : ""}</span>
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {ARCHIVE_DIFFS.map(({ id, label }) => {
              const r = recordFor(picked, id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => (picked === today ? onToday(id) : onPlay(picked, id))}
                  data-testid={`pdk-archive-${picked}-${id}`}
                  className="rounded border border-foreground/15 px-2 py-1.5 text-xs font-semibold hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {label}
                  <span className="block tabular-nums font-normal text-muted-foreground">{r?.over ? `${r.solved}/9${typeof r.score === "number" ? ` · ${r.score}` : ""}` : r?.guesses.length ? "In progress" : "Play"}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
