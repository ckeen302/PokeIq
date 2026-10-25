"use client";

import { Search } from "lucide-react";
import { PdkBoard, type BoardCell } from "@/components/pikadoku/parts";
import { spriteUrl } from "@/lib/pokemon/art";
import type { PdkGridView } from "@/lib/pikadoku/types";
import { cn } from "@/lib/utils";
import { DemoFrame, useDemoFrame } from "./shared";

/** A real grid: Fire, Water and Grass types against Kanto, Johto and Hoenn debuts. */
const GRID: PdkGridView = {
  rows: [
    { id: "type:fire", family: "types", label: "Fire" },
    { id: "type:water", family: "types", label: "Water" },
    { id: "type:grass", family: "types", label: "Grass" },
  ],
  cols: [
    { id: "region:1", family: "regions", label: "Kanto" },
    { id: "region:2", family: "regions", label: "Johto" },
    { id: "region:3", family: "regions", label: "Hoenn" },
  ],
};

/** Typhlosion (Fire, Gen 2) fits Fire and Johto; Swampert (Water/Ground, Gen 3) fits Water and Hoenn. */
const PICKS = [
  { id: 157, name: "Typhlosion", cell: 1 },
  { id: 260, name: "Swampert", cell: 5 },
];
const NAMES = new Map(PICKS.map((p) => [p.id, p.name]));

/** Literal class names, so Tailwind sees them: a filled box turns green. */
const GREEN: Record<number, string> = {
  1: "[&_[data-testid=demo-cell-1]]:!border-success [&_[data-testid=demo-cell-1]]:!bg-success/25",
  5: "[&_[data-testid=demo-cell-5]]:!border-success [&_[data-testid=demo-cell-5]]:!bg-success/25",
};

interface Frame {
  typed: string;
  /** The suggestion under the box. */
  pick: (typeof PICKS)[number] | null;
  filled: number;
  ms: number;
}
const FRAMES = (() => {
  const f: Frame[] = [{ typed: "", pick: null, filled: 0, ms: 800 }];
  PICKS.forEach((p, i) => {
    for (let k = 1; k <= 5; k++) f.push({ typed: p.name.slice(0, k), pick: k >= 2 ? p : null, filled: i, ms: 130 });
    f.push({ typed: p.name.slice(0, 5), pick: p, filled: i, ms: 600 });
    f.push({ typed: "", pick: null, filled: i + 1, ms: i === PICKS.length - 1 ? 2800 : 1500 });
  });
  return f;
})();
const MS = FRAMES.map((f) => f.ms);

export function PikadokuDemo() {
  const frame = FRAMES[useDemoFrame(MS)];
  const cells: BoardCell[] = Array.from({ length: 9 }, (_, i) => {
    const p = PICKS.slice(0, frame.filled).find((x) => x.cell === i);
    return { id: p?.id ?? null, highlight: frame.pick?.cell === i };
  });
  const green = PICKS.slice(0, frame.filled).map((p) => GREEN[p.cell]);
  return (
    <DemoFrame label="Demo: searching for Typhlosion and dropping it into the Fire and Johto box, then Swampert into Water and Hoenn">
      <div className="mx-auto max-w-sm space-y-3">
        <div className="relative">
          <div className="flex h-10 items-center gap-2 rounded-md border-2 border-foreground/15 bg-card px-3 text-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            {frame.typed ? (
              <span>
                {frame.typed}
                <span className="animate-pulse">|</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Search a Pokémon…</span>
            )}
          </div>
          <div className="h-10">
            {frame.pick && (
              <div className="absolute inset-x-0 z-10 mt-1 flex h-10 items-center gap-2 rounded-md border-2 border-primary/60 bg-card px-2 text-sm font-semibold shadow-lg">
                <img src={spriteUrl(frame.pick.id)} alt="" width={32} height={32} className="h-8 w-8" style={{ imageRendering: "pixelated" }} />
                {frame.pick.name}
              </div>
            )}
          </div>
        </div>
        <div className={cn(green)}>
          <PdkBoard grid={GRID} cells={cells} names={NAMES} testPrefix="demo" />
        </div>
      </div>
    </DemoFrame>
  );
}
