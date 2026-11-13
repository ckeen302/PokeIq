"use client";

import { Sheet } from "@/components/pokedle/sheets";
import { PDK_FAMILY_LABELS, PDK_PP, PDK_RULES, type PdkFamily } from "@/lib/pikadoku/types";
import { HowToActions, HowToCards } from "@/components/howto/shared";
import { PikadokuDemo } from "@/components/howto/PikadokuDemo";

/**
 * Pikadoku's how to play. It comes with the board, not with the other
 * pop-ups: a first visit's copy is in the page's HTML (see Pikadoku).
 */

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
    <Sheet title="How to play" onClose={onClose} wide>
      <div className="space-y-4 text-sm" data-testid="pdk-howto">
        <p className="hud-label">Fill the grid. Keep your score low.</p>
        <PikadokuDemo />
        <HowToCards
          cards={[
            { title: "The goal", body: <p>Fill all 9 boxes of the grid, each with a Pokémon that fits both its row and its column.</p> },
            { title: "Core rules", body: <p>You get {PDK_PP} guesses (PP), and a wrong guess uses one too. Each Pokémon can be used once.</p> },
            { title: "Scoring", body: <p>Fill as many boxes as you can. Your rarity score adds up the share of players who picked each of your answers: rarer picks, lower score.</p> },
          ]}
        />
        <details className="rounded-md border bg-shade/30 p-3">
          <summary className="tap cursor-pointer font-semibold max-sm:py-2.5">Full rules</summary>
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
              <b>Unlimited</b>: a board you build yourself. Pick the rules (unlimited PP, guaranteed solvable, one-answer boxes, a timer), a difficulty and the categories you want, then generate as many as you like.
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
