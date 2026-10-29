"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Sheet } from "@/components/pokedle/sheets";
import { cn } from "@/lib/utils";
import { iconButton } from "./parts";
import { PDK_FAMILY_LABELS, PDK_PP, PDK_RULES, type PdkDifficulty, type PdkFamily } from "@/lib/pikadoku/types";
import type { PdkPlay, PdkRecord } from "@/lib/pikadoku/play";
import { archiveDates, archiveKey, archiveMonths, monthGrid } from "@/lib/pikadoku/archive";
import { CONN_LAUNCH_DATE, connNumber } from "@/lib/connections/types";
import { HowToActions, HowToCards } from "@/components/howto/shared";
import { PikadokuDemo } from "@/components/howto/PikadokuDemo";
import { NextPuzzleCountdown } from "./results";

const KINDS: [PdkFamily, string][] = [
  ["types", "Fighting, Dual-type, Monotype (one matching type is enough)"],
  ["regions", "Kanto to Paldea, by where a Pokémon debuted (a regional form counts for the region it debuted in)"],
  ["evolution", "No evolution line, Stone or Item evolution, Not fully evolved (an evolution counts from either side: Pikachu and Raichu are both a Stone evolution)"],
  ["moves", "A few famous moves, such as Surf or Earthquake (Expert adds deeper learnsets)"],
  ["abilities", "Expert only: well-known and obscure abilities"],
  ["other", "Legendary, Mythical, Paradox, Ultra-Beast, First Partner, Fossil, Baby, Mega, GMax (Expert adds stat thresholds)"],
];

export function PdkHowToSheet({ onClose, onNever }: { onClose: () => void; onNever?: () => void }) {
  const tile = (big: string, small: string) => (
    <div className="rounded-md border border-foreground/10 p-3 text-center">
      <p className="font-display text-2xl font-bold tabular-nums">{big}</p>
      <p className="hud-label">{small}</p>
    </div>
  );
  return (
    <Sheet title="Fill the grid. Keep your score low." onClose={onClose} wide>
      <div className="space-y-4 text-sm" data-testid="pdk-howto">
        <PikadokuDemo />
        <HowToCards
          cards={[
            { title: "The goal", body: <p>Fill all 9 boxes of the grid, each with a Pokémon that fits both its row and its column.</p> },
            { title: "Core rules", body: <p>You get {PDK_PP} guesses (PP), and a wrong guess uses one too. Each Pokémon can be used once.</p> },
            { title: "Scoring", body: <p>Fill as many boxes as you can. Your rarity score adds up the share of players who picked each of your answers: rarer picks, lower score.</p> },
          ]}
        />
        <details className="rounded-md border bg-shade/30 p-3">
          <summary className="cursor-pointer font-semibold">Full rules</summary>
        <div className="mt-3 space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {tile("9", "boxes to fill")}
          {tile(String(PDK_PP), "guesses only")}
          {tile("0", "reused Pokémon")}
        </div>
        <div>
          <p className="hud-label mb-1.5">Core rules</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              Every box needs a Pokémon that fits <b>both</b> its row and its column. Each Pokémon can be used once.
            </li>
            <li>
              You get <b>{PDK_PP} guesses (PP)</b>, and a wrong guess uses one too. Correct answers lock in.
            </li>
            <li>
              Your <b>rarity score</b> starts at 900 (100 for every empty box). Each pick counts the share of players who chose it in that box, so rarer picks pull it down. <b>Lower is better.</b> Your share card colours each box: 🟪 under 1%, 🟦 under 10%, 🟩 under 25%, 🟨 25% or more.
            </li>
            <li>
              <b>Filled</b> counts your boxes. Tap <b>Rarity</b> to see the day&apos;s board.
            </li>
            <li>
              Tap the <b>i</b> on any category to see exactly what counts. When the game ends you see <b>every valid answer</b> for every box, and why each miss didn&apos;t fit.
            </li>
            <li>
              Every grid is checked to be solvable. Some days a hand-made <b>Master Puzzle</b> replaces the Daily Puzzle.
            </li>
          </ul>
        </div>
        <div>
          <p className="hud-label mb-1.5">Modes</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <b>Daily Puzzle</b>: one grid a day, the same for everyone. Under <b>More</b>: Easy and Expert dailies, the themed Weekly grid and the Archive of past dailies (these never move your streak).
            </li>
            <li>
              <b>Unlimited</b>: a fresh grid on demand, with unlimited PP, a soft-lock guard, single-answer boxes, a timer and the category families you want.
            </li>
            <li>
              <b>Tic Tac Toe</b>: two trainers share a grid and take turns claiming boxes. Three in a row wins; a wrong guess or a timeout passes the turn.
            </li>
          </ul>
        </div>
        <div>
          <p className="hud-label mb-1.5">Regions and forms</p>
          <ul className="list-disc space-y-1 pl-5" data-testid="pdk-rules">
            {PDK_RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="hud-label mb-1.5">What the categories can be</p>
          <dl className="space-y-1">
            {KINDS.map(([k, text]) => (
              <div key={k}>
                <dt className="inline font-semibold">{PDK_FAMILY_LABELS[k]}: </dt>
                <dd className="inline text-muted-foreground">{text}</dd>
              </div>
            ))}
          </dl>
        </div>
        </div>
        </details>
        <HowToActions onClose={onClose} onNever={onNever} />
      </div>
    </Sheet>
  );
}

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
