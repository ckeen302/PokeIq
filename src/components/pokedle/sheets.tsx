"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { dailyNumber, LAUNCH_DATE, previousDate } from "@/lib/daily";
import { DLE_FREEZE_EVERY, DLE_MAX_FREEZES, type DleResultLike, type DleStats } from "@/lib/dle-stats";
import { DLE_GUESS_COST, DLE_HINT_COST, DLE_HINT_EMOJI, DLE_HINT_KINDS, DLE_HINT_LABEL, DLE_MAX_GUESSES, DLE_MIN_SOLVE_POINTS, dleBasePoints, type DleRow } from "@/lib/dle-types";
import { DLE_COLUMN_BONUS, DLE_MAX_BONUS, DLE_STRICT_BONUS, dailyRules, rulesBonus } from "@/lib/dle-format";
import { Button } from "@/components/ui/button";
import { Board } from "./parts";
import { DLE_ASSISTS, DLE_ASSIST_INFO, multiplierText } from "@/lib/dle-assist";
import { cn } from "@/lib/utils";

/** Pokédle's pop-up sheets: how to play, stats and the archive. */

export function Sheet({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cn("relative my-8 w-full rounded-lg border-2 sm:my-auto border-foreground/15 bg-card p-5 shadow-2xl", wide ? "max-w-2xl" : "max-w-md")}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="font-display text-xl font-bold uppercase tracking-tight">{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Pikachu guessed when the answer is Raichu. */
const EXAMPLE: DleRow = {
  id: 25,
  name: "Pikachu",
  imageUrl: "",
  solved: false,
  cells: {
    gen: { value: "1", status: "match" },
    type1: { value: "Electric", status: "match" },
    type2: { value: "None", status: "match" },
    height: { value: "0.4 m", status: "higher" },
    weight: { value: "6 kg", status: "higher" },
    color: { value: "Yellow", status: "miss" },
    stage: { value: "1", status: "close-higher" },
  },
};

export function HowToSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="How to play" onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <p>
          Guess the mystery Pokémon in {DLE_MAX_GUESSES} tries (in Classic). Every guess shows how it compares with the answer. Say you guess Pikachu and the answer is Raichu:
        </p>
        <Board rows={[EXAMPLE]} flipNewest={false} />
        <ul className="space-y-1.5">
          <li>
            <b>🟩 ✓ Match:</b> the answer has the same.
          </li>
          <li>
            <b>🟨 ≈ Near:</b> the right type in the other slot, or <b>close</b> (dashed border, with an arrow): one generation or stage away, or a height or weight within 25%.
          </li>
          <li>
            <b>▲▼ Higher or lower:</b> the way to go, and not close.
          </li>
          <li>
            <b>⬛ ✕ No match.</b> Stage runs Baby, 1, 2, 3, and a Baby is never close.
          </li>
        </ul>
        <div className="space-y-1.5 rounded-md border bg-shade/30 p-3">
          <p className="font-semibold">Formats</p>
          <ul className="space-y-1">
            <li>
              <b>Classic:</b> the seven clues above, 8 guesses.
            </li>
            <li>
              <b>Stats:</b> Gen, Type 1, Type 2, Height and Weight; ✓ right, ▲▼ higher or lower (no close states), 🟨 the type in the other slot. Guesses scale with the
              generations: 5 for Gen 1 only, up to 9 for all nine (the daily).
            </li>
            <li>
              <b>Custom</b> (practice and duels): pick 3 or more clue columns.
            </li>
          </ul>
          <p>
            The daily comes in Classic and Stats: one puzzle each for everyone, each with its own streaks and stats. Practice games and duels add advanced settings: generations, 6, 8 or 10
            guesses, hints on or off, strict (▲▼ only, no close states), a 3-minute or 60-second timer, and a legendaries-only pool.
          </p>
        </div>
        <div className="space-y-1.5 rounded-md border bg-shade/30 p-3">
          <p className="font-semibold">Points and hints</p>
          <p>
            A solve scores {dleBasePoints(1).toLocaleString("en-US")} on the first guess, less {DLE_GUESS_COST} for each guess after it, never below {DLE_MIN_SOLVE_POINTS} ({dleBasePoints(DLE_MAX_GUESSES)}{" "}
            on Classic&apos;s last), the same as a duel without its speed bonus. A miss scores 0.
          </p>
          <p data-testid="bonus-rule">
            A harder board pays more: +{Math.round(DLE_COLUMN_BONUS * 100)}% for each clue column hidden and +{Math.round(DLE_STRICT_BONUS * 100)}% without close states, up to +
            {Math.round(DLE_MAX_BONUS * 100)}% (Stats: +{Math.round(rulesBonus(dailyRules("squirdle")) * 100)}%). It multiplies with the Pokédex level below.
          </p>
          <p>
            Hints are never automatic. After your first guess you can tap to use one:{" "}
            {DLE_HINT_KINDS.map((h) => `${DLE_HINT_EMOJI[h]} ${DLE_HINT_LABEL[h].toLowerCase()} −${DLE_HINT_COST[h]}`).join(", ")}. Each one used is marked on your result and your share.
          </p>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            <b className="text-foreground">The Pokédex</b> beside the board is your notebook. Like Wordle&apos;s keyboard, it greys out every Pokémon your generation and type clues rule out. Tap a Pokémon to cross it off, or switch to <i>Fill in</i> to put it in the guess box.
          </li>
          <li>
            <b className="text-foreground">The Pokédex</b> setting (Off, Notebook, Field Guide or Full; set it before your first guess; it stays for the game) is how much the Pokédex helps. Less help, more points:
            <ul className="mt-1 space-y-0.5 pl-1">
              {DLE_ASSISTS.map((a) => (
                <li key={a}>
                  {DLE_ASSIST_INFO[a].emoji} <b className="text-foreground">{DLE_ASSIST_INFO[a].label}</b> {multiplierText(a)}: {DLE_ASSIST_INFO[a].blurb}
                </li>
              ))}
            </ul>
            Your result and share show the level. Duels give both trainers the same one; ranked always uses the Notebook.
          </li>
          <li>
            <b className="text-foreground">Hard mode</b> (set it before your first guess): every guess must fit the generation and type clues so far, so no greyed-out Pokémon. Your share gets a *.
          </li>
          <li>
            <b className="text-foreground">Streaks:</b> finish the daily, won or lost, to keep your 🔥 play streak. Every {DLE_FREEZE_EVERY} days in a row earn a 🧊 freeze (up to {DLE_MAX_FREEZES}) that covers a missed day by itself.
          </li>
          <li>
            <b className="text-foreground">The archive</b> has every past Classic daily. Archive and practice games never count toward streaks or stats.
          </li>
          <li>
            Keys: <kbd className="rounded border px-1">/</kbd> jumps to the guess box, <kbd className="rounded border px-1">↑</kbd> <kbd className="rounded border px-1">↓</kbd> and <kbd className="rounded border px-1">Enter</kbd> pick, <kbd className="rounded border px-1">Esc</kbd> clears.
          </li>
        </ul>
        <Button className="w-full" onClick={onClose}>
          Let&apos;s play
        </Button>
      </div>
    </Sheet>
  );
}

export function StatsSheet({ stats, todayGuesses, onClose, title = "Statistics" }: { stats: DleStats; todayGuesses: number | null; onClose: () => void; title?: string }) {
  const tiles = [
    { label: "Played", value: stats.played },
    { label: "Win %", value: stats.winPct },
    { label: "Play streak", value: `🔥${stats.playStreak}`, sub: `Best ${stats.bestPlayStreak}` },
    { label: "Win streak", value: stats.winStreak, sub: `Best ${stats.bestWinStreak}` },
  ];
  const bars = [...stats.distribution.map((n, i) => ({ label: String(i + 1), n, today: todayGuesses === i + 1 })), { label: "X", n: stats.losses, today: todayGuesses === 0 }];
  const peak = Math.max(1, ...bars.map((b) => b.n));
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="space-y-5 text-sm">
        <div className="grid grid-cols-4 gap-2 text-center">
          {tiles.map((t) => (
            <div key={t.label}>
              <div className="font-display text-2xl font-bold tabular-nums">{t.value}</div>
              <div className="text-[11px] text-muted-foreground">{t.label}</div>
              {t.sub && <div className="text-[10px] text-muted-foreground">{t.sub}</div>}
            </div>
          ))}
        </div>
        <p className="rounded-md border bg-shade/30 px-3 py-2">
          🧊 Streak freezes: <b>{stats.freezes}</b> of {DLE_MAX_FREEZES}. You earn one every {DLE_FREEZE_EVERY} days in a row; a missed day uses one by itself.
          {stats.savedByFreeze && stats.playStreak > 0 && (
            <span className="block text-success">Your freeze kept your 🔥{stats.playStreak} alive.</span>
          )}
        </p>
        <div>
          <p className="hud-label mb-2">Guess distribution</p>
          <div className="space-y-1" role="list" aria-label="Wins by number of guesses">
            {bars.map((b) => (
              <div key={b.label} className="flex items-center gap-2" role="listitem" aria-label={`${b.label === "X" ? "Missed" : `${b.label} guess${b.label === "1" ? "" : "es"}`}: ${b.n}`}>
                <span className="w-3 text-right font-semibold tabular-nums">{b.label}</span>
                <div
                  className={cn("flex h-5 min-w-[1.5rem] items-center justify-end rounded-sm px-1.5 text-[11px] font-semibold", b.today ? "dle-match" : "bg-secondary")}
                  style={{ width: `${Math.max(6, (100 * b.n) / peak)}%` }}
                >
                  {b.n}
                </div>
              </div>
            ))}
          </div>
        </div>
        {stats.hardWins > 0 && <p className="text-muted-foreground">Hard-mode wins: {stats.hardWins}</p>}
        <p className="text-xs text-muted-foreground">Only dailies count. Practice and archive games never change your stats or streaks.</p>
      </div>
    </Sheet>
  );
}

/** Every past daily, newest first, with how it went. */
export function ArchiveSheet({
  today,
  daily,
  archive,
  onPlay,
  onClose,
}: {
  today: string;
  daily: Readonly<Record<string, DleResultLike>>;
  archive: Readonly<Record<string, DleResultLike>>;
  onPlay: (date: string) => void;
  onClose: () => void;
}) {
  const dates: string[] = [];
  for (let d = previousDate(today); d >= LAUNCH_DATE; d = previousDate(d)) dates.push(d);
  const status = (r: DleResultLike | undefined) =>
    !r ? "Not played" : r.over ? (r.solved ? `Solved in ${r.guesses.length}` : "Missed") : r.guesses.length ? `In progress · ${r.guesses.length}/${DLE_MAX_GUESSES}` : "Not played";
  return (
    <Sheet title="Archive" onClose={onClose}>
      <p className="mb-3 text-sm text-muted-foreground">Play any past daily. Archive games are just for fun: they never count toward your streaks or stats.</p>
      {dates.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No past dailies yet. Come back tomorrow.</p>
      ) : (
        <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
          {dates.map((d) => {
            const played = daily[d]?.over ? daily[d] : undefined;
            return (
              <li key={d}>
                <button
                  type="button"
                  onClick={() => onPlay(d)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-screen/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-semibold">
                    #{dailyNumber(d)} <span className="font-normal text-muted-foreground">· {d}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{played ? `${status(played)} (daily)` : status(archive[d])}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
