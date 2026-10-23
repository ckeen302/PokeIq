"use client";

import { Sheet } from "@/components/pokedle/sheets";
import { PDK_FAMILY_LABELS, PDK_PP, PDK_RULES, type PdkFamily } from "@/lib/pikadoku/types";
import type { PdkPlay } from "@/lib/pikadoku/play";

const KINDS: [PdkFamily, string][] = [
  ["types", "Fire type, Dual-typed (one matching type is enough)"],
  ["regions", "Introduced in Kanto to Paldea, has an Alolan, Galarian, Hisuian or Paldean form"],
  ["evolution", "Basic, fully evolved, evolves with a stone, by trade or friendship, branching evolution"],
  ["moves", "Learns Trick Room, Surf or Stealth Rock in Scarlet & Violet"],
  ["abilities", "Has Levitate or Intimidate (any slot), has a hidden ability"],
  ["other", "Legendary, Mythical, fossil, baby, has a Mega or Gigantamax form, base Speed 100+, base stat total 600+, OU-relevant"],
];

export function PdkHowToSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="How to play" onClose={onClose} wide>
      <div className="space-y-4 text-sm" data-testid="pdk-howto">
        <p>
          Fill the <b>3×3 grid</b>: every cell needs a Pokémon that fits <b>both</b> its row and its column. A Pokémon can be used once.
        </p>
        <ul className="space-y-1.5">
          <li>
            You have <b>{PDK_PP} guesses (PP)</b> in a daily, and a wrong guess uses one too. Correct answers lock in.
          </li>
          <li>
            Your <b>uniqueness score</b> is the sum of the share of players who picked each of your answers: <b>lower is better</b>. Each cell shows its rarity once it locks.
          </li>
          <li>
            <b>Easy, Normal and Expert</b> dailies: Normal is the main grid for the leaderboard. Every grid is checked to be solvable.
          </li>
          <li>
            When the game ends you see <b>every valid answer</b> for every cell, rarest first, and why each miss didn&apos;t fit.
          </li>
          <li>
            <b>Unlimited</b> deals a new grid on demand: unlimited PP, a soft-lock guard, single-answer cells, a timer, and the category families you want.
          </li>
          <li>
            <b>Tic Tac Toe</b>: two trainers share a grid and take turns claiming cells. Three in a row wins; a wrong guess or a timeout passes the turn.
          </li>
        </ul>
        <div>
          <p className="hud-label mb-1.5">Forms and regions</p>
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
