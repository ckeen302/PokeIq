"use client";

import { useMemo } from "react";
import { Board } from "@/components/pokedle/parts";
import { DLE_EXAMPLE_MONS, exampleRow } from "@/components/pokedle/examples";
import { useDleWords } from "@/components/pokedle/lexicon";
import { useT } from "@/i18n/client";
import game from "@/messages/pokedle-game";
import { DemoFrame, FitWidth, useDemoFrame } from "./shared";

/** Mareep, then Pikachu, then Raichu (the answer), through the game's own clue code. */
const MON = [DLE_EXAMPLE_MONS.mareep, DLE_EXAMPLE_MONS.pikachu, DLE_EXAMPLE_MONS.raichu];
const ANSWER = MON[2];
const COLUMNS = ["gen", "type1", "height", "weight", "color", "stage"] as const;

/** Each name typed letter by letter, then its row (the names in the page's language). */
function framesOf(names: readonly string[]) {
  const f: { typed: string; rows: number; ms: number }[] = [{ typed: "", rows: 0, ms: 700 }];
  names.forEach((name, g) => {
    const letters = [...name];
    for (let k = 1; k <= letters.length; k++) f.push({ typed: letters.slice(0, k).join(""), rows: g, ms: 110 });
    f.push({ typed: "", rows: g + 1, ms: g === names.length - 1 ? 2800 : 2000 });
  });
  return f;
}

export function PokedleDemo() {
  const t = useT(game);
  const words = useDleWords();
  const names = useMemo(() => MON.map((m) => words.name(m.id, m.name)), [words]);
  const frames = useMemo(() => framesOf(names), [names]);
  const ms = useMemo(() => frames.map((f) => f.ms), [frames]);
  const frame = frames[useDemoFrame(ms)] ?? frames[0];
  const rows = useMemo(() => MON.map((m) => exampleRow(m, ANSWER, COLUMNS)), []);
  const solved = frame.rows === MON.length;
  return (
    <DemoFrame label={t("demo.label", { a: names[0], b: names[1], c: names[2] })}>
      <div className="mx-auto max-w-xl space-y-3">
        <div className="flex h-10 items-center rounded-md border-2 border-foreground/15 bg-card px-3 text-sm">
          {frame.typed ? (
            <span>
              {frame.typed}
              <span className="animate-pulse">|</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{t("demo.placeholder")}</span>
          )}
        </div>
        {/* From 640px up the board has fixed tracks, 34.75rem in all: its room is kept at that width from the start and scaled to fit the pop-up, so the demo never changes size. */}
        <FitWidth>
          <div className="min-h-[13.5rem] max-md:min-h-[16.75rem] sm:w-[34.75rem]">{frame.rows > 0 && <Board rows={rows.slice(0, frame.rows)} columns={COLUMNS} />}</div>
        </FitWidth>
        <p className="min-h-5 text-center text-sm font-semibold max-md:min-h-10">{solved ? t("demo.solved") : frame.rows === 1 ? t("demo.closer") : ""}</p>
      </div>
    </DemoFrame>
  );
}
