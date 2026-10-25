"use client";

import { useMemo } from "react";
import { compareTraits, stageLabel, type DleTraits } from "@/lib/dle-compare";
import type { DleRow } from "@/lib/dle-types";
import { formatHeight, formatWeight } from "@/lib/pokemon/constants";
import { Board } from "@/components/pokedle/parts";
import { DemoFrame, useDemoFrame } from "./shared";

/** Real Pokédex values (height in dm, weight in hg), run through the game's own clue code. */
const MON: { id: number; name: string; t: DleTraits }[] = [
  { id: 179, name: "Mareep", t: { gen: 2, type1: "electric", type2: null, height: 6, weight: 78, color: "white", stage: 1 } },
  { id: 25, name: "Pikachu", t: { gen: 1, type1: "electric", type2: null, height: 4, weight: 60, color: "yellow", stage: 2 } },
  { id: 26, name: "Raichu", t: { gen: 1, type1: "electric", type2: null, height: 8, weight: 300, color: "yellow", stage: 3 } },
];
const ANSWER = MON[2];
const COLUMNS = ["gen", "type1", "height", "weight", "color", "stage"] as const;

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function toRow(m: (typeof MON)[number]): DleRow {
  const s = compareTraits(m.t, ANSWER.t);
  const value = {
    gen: String(m.t.gen),
    type1: cap(m.t.type1),
    height: formatHeight(m.t.height),
    weight: formatWeight(m.t.weight),
    color: cap(m.t.color),
    stage: stageLabel(m.t.stage),
  };
  const cells = Object.fromEntries(COLUMNS.map((c) => [c, { value: value[c], status: s[c]! }])) as DleRow["cells"];
  return { id: m.id, name: m.name, imageUrl: "", solved: m.id === ANSWER.id, cells };
}

const FRAMES = (() => {
  const f: { typed: string; rows: number; ms: number }[] = [{ typed: "", rows: 0, ms: 700 }];
  MON.forEach((m, g) => {
    for (let k = 1; k <= m.name.length; k++) f.push({ typed: m.name.slice(0, k), rows: g, ms: 110 });
    f.push({ typed: "", rows: g + 1, ms: g === MON.length - 1 ? 2800 : 2000 });
  });
  return f;
})();
const MS = FRAMES.map((f) => f.ms);

export function PokedleDemo() {
  const frame = FRAMES[useDemoFrame(MS)];
  const rows = useMemo(() => MON.map(toRow), []);
  const solved = frame.rows === MON.length;
  return (
    <DemoFrame label="Demo: guessing Mareep, then Pikachu, then Raichu, with the clue tiles flipping after each guess">
      <div className="mx-auto max-w-xl space-y-3">
        <div className="flex h-10 items-center rounded-md border-2 border-foreground/15 bg-card px-3 text-sm">
          {frame.typed ? (
            <span>
              {frame.typed}
              <span className="animate-pulse">|</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Guess a Pokémon…</span>
          )}
        </div>
        <div className="min-h-[13.5rem]">{frame.rows > 0 && <Board rows={rows.slice(0, frame.rows)} columns={COLUMNS} />}</div>
        <p className="h-5 text-center text-sm font-semibold">{solved ? "Solved in 3 guesses!" : frame.rows === 1 ? "Closer: ≈ is one generation or stage away" : ""}</p>
      </div>
    </DemoFrame>
  );
}
