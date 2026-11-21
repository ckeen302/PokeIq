"use client";

import { Search } from "lucide-react";
import { PdkBoard, useCatLabel, usePdkLocal, type BoardCell } from "@/components/pikadoku/parts";
import { spriteUrl } from "@/lib/pokemon/art";
import type { PdkGridView } from "@/lib/pikadoku/types";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import pikadoku from "@/messages/pikadoku";
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
type Pick = (typeof PICKS)[number];

/** Literal class names, so Tailwind sees them: a filled box turns green. */
const GREEN: Record<number, string> = {
  1: "[&_[data-testid=demo-cell-1]]:!border-success [&_[data-testid=demo-cell-1]]:!bg-success/25",
  5: "[&_[data-testid=demo-cell-5]]:!border-success [&_[data-testid=demo-cell-5]]:!bg-success/25",
};

interface Frame {
  /** How many letters of the pick's name are typed (the pick after the boxes already filled). */
  typed: number;
  /** The suggestion under the box. */
  pick: Pick | null;
  filled: number;
  ms: number;
}
const FRAMES = (() => {
  const f: Frame[] = [{ typed: 0, pick: null, filled: 0, ms: 800 }];
  PICKS.forEach((p, i) => {
    for (let k = 1; k <= 5; k++) f.push({ typed: k, pick: k >= 2 ? p : null, filled: i, ms: 130 });
    f.push({ typed: 5, pick: p, filled: i, ms: 600 });
    f.push({ typed: 0, pick: null, filled: i + 1, ms: i === PICKS.length - 1 ? 2800 : 1500 });
  });
  return f;
})();
const MS = FRAMES.map((f) => f.ms);

export function PikadokuDemo() {
  const frame = FRAMES[useDemoFrame(MS)];
  const t = useT(pikadoku);
  const local = usePdkLocal();
  const labelOf = useCatLabel();
  // The names as the page shows them (a page in another language has its own).
  const nameOf = (p: Pick) => local?.names[p.id]?.[0] ?? p.name;
  const names = new Map(PICKS.map((p) => [p.id, nameOf(p)]));
  const typing = PICKS[frame.filled];
  const typed = frame.typed && typing ? [...nameOf(typing)].slice(0, frame.typed).join("") : "";
  const cells: BoardCell[] = Array.from({ length: 9 }, (_, i) => {
    const p = PICKS.slice(0, frame.filled).find((x) => x.cell === i);
    return { id: p?.id ?? null, highlight: frame.pick?.cell === i };
  });
  const green = PICKS.slice(0, frame.filled).map((p) => GREEN[p.cell]);
  return (
    <DemoFrame
      label={t("demo.label", {
        first: nameOf(PICKS[0]),
        fire: labelOf(GRID.rows[0]),
        johto: labelOf(GRID.cols[1]),
        second: nameOf(PICKS[1]),
        water: labelOf(GRID.rows[1]),
        hoenn: labelOf(GRID.cols[2]),
      })}
    >
      <div className="mx-auto max-w-sm space-y-3">
        <div className="relative">
          <div className="flex h-10 items-center gap-2 rounded-md border-2 border-foreground/15 bg-card px-3 text-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            {typed ? (
              <span>
                {typed}
                <span className="animate-pulse">|</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{t("demo.search")}</span>
            )}
          </div>
          <div className="h-10">
            {frame.pick && (
              <div className="absolute inset-x-0 z-10 mt-1 flex h-10 items-center gap-2 rounded-md border-2 border-primary/60 bg-card px-2 text-sm font-semibold shadow-lg">
                <img src={spriteUrl(frame.pick.id)} alt="" width={32} height={32} loading="lazy" className="h-8 w-8" style={{ imageRendering: "pixelated" }} />
                {nameOf(frame.pick)}
              </div>
            )}
          </div>
        </div>
        <div className={cn(green)}>
          <PdkBoard grid={GRID} cells={cells} names={names} testPrefix="demo" />
        </div>
      </div>
    </DemoFrame>
  );
}
