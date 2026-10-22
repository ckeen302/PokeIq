"use client";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/pokedle/sheets";
import { DLE_FREEZE_EVERY, DLE_MAX_FREEZES, type DleStats } from "@/lib/dle-stats";
import { CONN_LAUNCH_DATE, CONN_LEVELS, CONN_MAX_MISTAKES, connNumber, type ConnLevel } from "@/lib/connections/types";
import type { ConnRecord } from "@/lib/progress";
import { previousDate } from "@/lib/daily";
import { LevelMark, levelStyle } from "./parts";
import { cn } from "@/lib/utils";

/** PokéConnections' pop-up sheets: how to play, stats and the archive (Pokédle's sheet style). */

const KINDS: [string, string][] = [
  ["Types", "Fire type, pure Water type, Water/Ground"],
  ["Origins", "debuted in Gen 4, Legendary, Mythical"],
  ["Evolution", "evolved with a stone, by trade or by friendship; baby Pokémon"],
  ["Battle", "can have an Ability (Hidden ones count), a Hidden Ability, learns a move by level-up in Scarlet & Violet"],
  ["Stats", "highest base stat is Speed, base stat total 600+"],
  ["Size and look", "weighs 300 kg or more, 3 m tall or more, Pokédex colour"],
  ["Forms", "has an Alolan form, can Mega Evolve, has a Gigantamax form"],
  ["Breeding", "Egg Group, always male, genderless"],
  ["Names", "starts with the same letter, ends in “-ite”, four letters or fewer"],
];

export function ConnHowToSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="How to play" onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <p>
          Find the <b>four groups of four</b> Pokémon that share something. Pick four tiles and press <b>Submit</b>: a whole group locks in as a coloured bar.
        </p>
        <ul className="space-y-1.5">
          <li>
            <b>{CONN_MAX_MISTAKES} mistakes</b> and the game is over (the dots under the grid).
          </li>
          <li>
            <b>“One away…”</b> means three of your four belong together.
          </li>
          <li>
            <b>Already guessed:</b> trying the same four again never costs a mistake.
          </li>
          <li>Every Pokémon fits exactly one group, so the groups only work out one way. Watch for red herrings: a Fire type that isn&apos;t in the Fire group.</li>
        </ul>
        <div className="space-y-2 rounded-md border bg-shade/30 p-3">
          <p className="font-semibold">Colours, easiest to trickiest</p>
          <div className="flex flex-wrap gap-2">
            {CONN_LEVELS.map((l, i) => (
              <span key={l.name} className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-bold uppercase tracking-wide" style={levelStyle(i as ConnLevel)}>
                <LevelMark level={i as ConnLevel} /> {l.name}
              </span>
            ))}
          </div>
        </div>
        <div className="space-y-1.5 rounded-md border bg-shade/30 p-3">
          <p className="font-semibold">What links them</p>
          <ul className="space-y-1">
            {KINDS.map(([k, v]) => (
              <li key={k}>
                <b>{k}:</b> <span className="text-muted-foreground">{v}</span>
              </li>
            ))}
          </ul>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            <b className="text-foreground">Base forms only.</b> Every tile is the Pokémon&apos;s standard form: regional forms, Megas and other forms don&apos;t count unless the group is about them
            (like “Has an Alolan form”). Types, Abilities, stats and Egg Groups are today&apos;s, and move groups are about Scarlet &amp; Violet.
          </li>
          <li>
            <b className="text-foreground">Every fact comes from the Pokédex data</b>, and after the game the <b className="text-foreground">Why?</b> panel explains each group, Pokémon by Pokémon.
          </li>
          <li>
            <b className="text-foreground">A new puzzle every day</b> at your midnight, the same one for everyone. Finish it, won or lost, to keep your 🔥 streak; past dailies are in the archive and practice
            puzzles are unlimited (neither counts toward your stats).
          </li>
          <li>
            Keys: <kbd className="rounded border px-1">Tab</kbd> and the arrow keys move between tiles, <kbd className="rounded border px-1">Space</kbd> picks one,{" "}
            <kbd className="rounded border px-1">Enter</kbd> submits four, <kbd className="rounded border px-1">Esc</kbd> deselects all.
          </li>
        </ul>
        <Button className="w-full" onClick={onClose}>
          Let&apos;s play
        </Button>
      </div>
    </Sheet>
  );
}

export function ConnStatsSheet({ stats, todayMistakes, onClose }: { stats: DleStats; todayMistakes: number | null; onClose: () => void }) {
  const tiles = [
    { label: "Played", value: stats.played },
    { label: "Win %", value: stats.winPct },
    { label: "Current streak", value: `🔥${stats.playStreak}` },
    { label: "Max streak", value: stats.bestPlayStreak },
  ];
  const bars = [...stats.distribution.map((n, i) => ({ label: String(i), n, today: todayMistakes === i })), { label: "X", n: stats.losses, today: todayMistakes === CONN_MAX_MISTAKES }];
  const peak = Math.max(1, ...bars.map((b) => b.n));
  return (
    <Sheet title="Statistics" onClose={onClose}>
      <div className="space-y-5 text-sm">
        <div className="grid grid-cols-4 gap-2 text-center">
          {tiles.map((t) => (
            <div key={t.label}>
              <div className="font-display text-2xl font-bold tabular-nums">{t.value}</div>
              <div className="text-[11px] text-muted-foreground">{t.label}</div>
            </div>
          ))}
        </div>
        <p className="rounded-md border bg-shade/30 px-3 py-2">
          🧊 Streak freezes: <b>{stats.freezes}</b> of {DLE_MAX_FREEZES}. You earn one every {DLE_FREEZE_EVERY} days in a row; a missed day uses one by itself. Win streak: <b>{stats.winStreak}</b> (best{" "}
          {stats.bestWinStreak}).
        </p>
        <div>
          <p className="hud-label mb-2">Mistakes distribution</p>
          <div className="space-y-1" role="list" aria-label="Wins by number of mistakes">
            {bars.map((b) => (
              <div key={b.label} className="flex items-center gap-2" role="listitem" aria-label={`${b.label === "X" ? "Not solved" : `${b.label} mistake${b.label === "1" ? "" : "s"}`}: ${b.n}`}>
                <span className="w-3 text-right font-semibold tabular-nums">{b.label}</span>
                <div
                  className={cn("flex h-5 min-w-[1.5rem] items-center justify-end rounded-sm px-1.5 text-[11px] font-semibold", b.today ? "bg-screen text-background" : "bg-secondary")}
                  style={{ width: `${Math.max(6, (100 * b.n) / peak)}%` }}
                >
                  {b.n}
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Only dailies count. Practice and archive games never change your stats or streaks.</p>
      </div>
    </Sheet>
  );
}

/** Every past daily, newest first, with how it went. */
export function ConnArchiveSheet({
  today,
  daily,
  archive,
  onPlay,
  onClose,
}: {
  today: string;
  daily: Readonly<Record<string, ConnRecord>>;
  archive: Readonly<Record<string, ConnRecord>>;
  onPlay: (date: string) => void;
  onClose: () => void;
}) {
  const dates: string[] = [];
  for (let d = previousDate(today); d >= CONN_LAUNCH_DATE; d = previousDate(d)) dates.push(d);
  const status = (r: ConnRecord | undefined) =>
    !r ? "Not played" : r.over ? (r.solved ? (r.mistakes ? `Solved · ${r.mistakes} mistake${r.mistakes === 1 ? "" : "s"}` : "Perfect") : "Missed") : r.guesses.length ? "In progress" : "Not played";
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
                    #{connNumber(d)} <span className="font-normal text-muted-foreground">· {d}</span>
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
