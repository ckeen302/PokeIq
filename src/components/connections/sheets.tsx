"use client";

import { Sheet } from "@/components/pokedle/sheets";
import type { DleStats } from "@/lib/dle-stats";
import { CONN_LEVELS_4, CONN_MAX_MISTAKES, type ConnLevel } from "@/lib/connections/types";
import type { ConnRecord } from "@/lib/progress";
import { LevelMark, levelStyle } from "./parts";
import { ConnArchiveCalendar, ConnStatsBody } from "./stats";
import { HowToActions, HowToCards } from "@/components/howto/shared";
import { ConnectionsDemo } from "@/components/howto/ConnectionsDemo";

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

export function ConnHowToSheet({ onClose, onNever }: { onClose: () => void; onNever?: () => void }) {
  return (
    <Sheet title="How to play" onClose={onClose} wide>
      <div className="space-y-4 text-sm" data-testid="howto-sheet">
        <ConnectionsDemo />
        <HowToCards
          cards={[
            { title: "The goal", body: <p>Find the four groups of four Pokémon that share something. Pick four tiles and press Submit: a whole group locks in as a coloured bar.</p> },
            {
              title: "Core rules",
              body: (
                <p>
                  {CONN_MAX_MISTAKES} mistakes and the game is over. “One away…” means three of your four belong together. Trying the same four again never costs a mistake.
                </p>
              ),
            },
            { title: "Colours", body: <p>Yellow is the easiest group and purple the trickiest. Watch for red herrings: a Fire type that isn&apos;t in the Fire group.</p> },
            { title: "Daily", body: <p>A new puzzle every day, the same for everyone. Finish it, won or lost, to keep your 🔥 streak.</p> },
          ]}
        />
        <details className="rounded-md border bg-shade/30 p-3">
          <summary className="cursor-pointer font-semibold">Full rules</summary>
        <div className="mt-3 space-y-4">
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
            {CONN_LEVELS_4.map((l, i) => (
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
        </div>
        </details>
        <HowToActions onClose={onClose} onNever={onNever} />
      </div>
    </Sheet>
  );
}

export function ConnStatsSheet({ stats, todayMistakes, onClose }: { stats: DleStats; todayMistakes: number | null; onClose: () => void }) {
  return (
    <Sheet title="Statistics" onClose={onClose}>
      <div className="space-y-5 text-sm">
        <ConnStatsBody stats={stats} todayMistakes={todayMistakes} />
        <p className="text-xs text-muted-foreground">Only dailies count. Practice and archive games never change your stats or streaks.</p>
      </div>
    </Sheet>
  );
}

/** Every daily since launch on a calendar, coloured by how it went. */
export function ConnArchiveSheet({
  today,
  daily,
  archive,
  onPlay,
  onToday,
  onClose,
}: {
  today: string;
  daily: Readonly<Record<string, ConnRecord>>;
  archive: Readonly<Record<string, ConnRecord>>;
  onPlay: (date: string) => void;
  onToday: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Archive" onClose={onClose}>
      <p className="mb-3 text-sm text-muted-foreground">Play any past daily. Archive games are just for fun: they never count toward your streaks or stats.</p>
      <ConnArchiveCalendar today={today} daily={daily} archive={archive} onPlay={onPlay} onToday={onToday} />
    </Sheet>
  );
}
