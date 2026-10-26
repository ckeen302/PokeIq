"use client";

import { Sheet } from "@/components/pokedle/sheets";
import { PDK_FAMILY_LABELS, PDK_PP, PDK_RULES, type PdkDifficulty, type PdkFamily } from "@/lib/pikadoku/types";
import type { PdkPlay, PdkRecord } from "@/lib/pikadoku/play";
import { archiveDates, archiveKey } from "@/lib/pikadoku/archive";
import { connNumber } from "@/lib/connections/types";
import { HowToActions, HowToCards } from "@/components/howto/shared";
import { PikadokuDemo } from "@/components/howto/PikadokuDemo";

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
            { title: "Scoring", body: <p>UNIQ starts at 900 and rarer picks pull it down: lower is better. PTS is the number of boxes you filled.</p> },
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
              <b>UNIQ</b> starts at 900 (100 for every empty box). Each pick counts the share of players who chose it, so rarer picks pull it down. <b>Lower is better.</b>
            </li>
            <li>
              <b>PTS</b> is the number of boxes you have filled. Tap <b>UNIQ</b> to see your rank on the board.
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

export function PdkStatsSheet({ streak, best, play, onClose }: { streak: number; best: number; play: PdkPlay; onClose: () => void }) {
  const cell = (label: string, value: number | string) => (
    <div className="rounded-md border border-foreground/10 p-3 text-center">
      <p className="font-display text-2xl font-bold tabular-nums">{value}</p>
      <p className="hud-label">{label}</p>
    </div>
  );
  return (
    <Sheet title="Statistics" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2" data-testid="pdk-stats">
        {cell("Current streak", streak)}
        {cell("Best streak", best)}
        {cell("Played", play.games)}
        {cell("Perfect 9/9", play.wins)}
        {cell("Duel wins", play.duelWins)}
        {cell("Duel losses", play.duelLosses)}
      </div>
    </Sheet>
  );
}

const ARCHIVE_DIFFS: { id: PdkDifficulty; label: string }[] = [
  { id: "easy", label: "Easy" },
  { id: "normal", label: "Normal" },
  { id: "expert", label: "Expert" },
];

/** Every past daily, all three difficulties. Archive games never reach the board, the streak or the daily results. */
export function PdkArchiveSheet({ today, archive, onPlay, onClose }: { today: string; archive: Readonly<Record<string, PdkRecord>>; onPlay: (date: string, difficulty: PdkDifficulty) => void; onClose: () => void }) {
  const dates = archiveDates(today);
  const status = (r: PdkRecord | undefined) => (!r ? "" : r.over ? (r.won ? "9/9" : `${r.solved}/9`) : r.guesses.length ? "…" : "");
  return (
    <Sheet title="Archive" onClose={onClose}>
      <p className="mb-3 text-sm text-muted-foreground">Play any past daily at any difficulty. Archive games are just for fun: they never count toward the daily board or your streak.</p>
      {dates.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground" data-testid="pdk-archive-empty">
          No past dailies yet. Come back tomorrow.
        </p>
      ) : (
        <ul className="max-h-[60vh] space-y-1 overflow-y-auto" data-testid="pdk-archive-list">
          {dates.map((d) => (
            <li key={d} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="font-semibold">
                #{connNumber(d)} <span className="font-normal text-muted-foreground">· {d}</span>
              </span>
              <span className="flex gap-1">
                {ARCHIVE_DIFFS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onPlay(d, id)}
                    data-testid={`pdk-archive-${d}-${id}`}
                    className="rounded border border-foreground/15 px-2 py-1 text-xs font-semibold hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {label} <span className="tabular-nums text-muted-foreground">{status(archive[archiveKey(d, id)])}</span>
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
