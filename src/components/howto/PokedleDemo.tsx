"use client";

import { useMemo } from "react";
import { Board } from "@/components/pokedle/parts";
import { DLE_EXAMPLE_MONS, exampleRow } from "@/components/pokedle/examples";
import { DemoFrame, useDemoFrame } from "./shared";

/** Mareep, then Pikachu, then Raichu (the answer), through the game's own clue code. */
const MON = [DLE_EXAMPLE_MONS.mareep, DLE_EXAMPLE_MONS.pikachu, DLE_EXAMPLE_MONS.raichu];
const ANSWER = MON[2];
const COLUMNS = ["gen", "type1", "height", "weight", "color", "stage"] as const;

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
  const rows = useMemo(() => MON.map((m) => exampleRow(m, ANSWER, COLUMNS)), []);
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
        <p className="min-h-5 text-center text-sm font-semibold">{solved ? "Solved in 3 guesses!" : frame.rows === 1 ? "Closer: ≈ is one generation or stage away" : ""}</p>
      </div>
    </DemoFrame>
  );
}
