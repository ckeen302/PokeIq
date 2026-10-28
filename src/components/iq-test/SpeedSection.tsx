"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { SkipForward } from "lucide-react";
import { sameGlyph, speedRow } from "@/lib/cognitive/speed";
import { Button } from "@/components/ui/button";
import { HpBar } from "@/components/game/HpBar";
import { cn } from "@/lib/utils";
import { GlyphView } from "./CellView";

/**
 * Processing speed: for `ms`, a target and a row of six; tap every one that
 * matches. The row moves on once every match is found, or on Skip. Reports
 * hits and false taps when the clock runs out.
 */
export function SpeedSection({ seed, ms, onDone }: { seed: string; ms: number; onDone: (hits: number, falseTaps: number) => void }) {
  const [index, setIndex] = useState(0);
  const [marks, setMarks] = useState<("hit" | "miss" | null)[]>(() => Array(6).fill(null));
  const [now, setNow] = useState(() => Date.now());
  const startRef = useRef(Date.now());
  const tallyRef = useRef({ hits: 0, falseTaps: 0 });
  const doneRef = useRef(false);
  const row = speedRow(seed, index);

  const left = Math.max(0, ms - (now - startRef.current));

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (left > 0 || doneRef.current) return;
    doneRef.current = true;
    onDone(tallyRef.current.hits, tallyRef.current.falseTaps);
  }, [left, onDone]);

  const advance = useCallback(() => {
    setIndex((i) => i + 1);
    setMarks(Array(6).fill(null));
  }, []);

  const tap = useCallback(
    (i: number) => {
      if (marks[i] !== null || left <= 0) return;
      const hit = sameGlyph(row.row[i], row.target);
      if (hit) tallyRef.current.hits++;
      else tallyRef.current.falseTaps++;
      const next = [...marks];
      next[i] = hit ? "hit" : "miss";
      setMarks(next);
      if (row.matches.every((m) => next[m] === "hit")) setTimeout(advance, 120);
    },
    [marks, left, row, advance]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[1-6]$/.test(e.key)) tap(Number(e.key) - 1);
      else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        advance();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tap, advance]);

  const { hits, falseTaps } = tallyRef.current;
  return (
    <div className="space-y-5" data-testid="cog-speed">
      <div className="flex items-center gap-3">
        <HpBar value={left / ms} label="TIME" className="flex-1" />
        <span className={cn("w-8 text-right font-pixel text-xs tabular-nums", left < ms * 0.2 && "animate-blink text-destructive")}>{Math.ceil(left / 1000)}</span>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-foreground/10 bg-shade/20 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="hud-label">Find</span>
          <motion.div key={row.id} initial={{ scale: 0.6 }} animate={{ scale: 1 }} className="screen flex h-16 w-16 items-center justify-center rounded-md">
            <span className="relative z-[3]">
              <GlyphView glyph={row.target} size={48} />
            </span>
          </motion.div>
        </div>
        <div className="text-right font-pixel text-xs text-muted-foreground">
          <div>
            <span className="text-success">{hits}</span> hit
          </div>
          <div>
            <span className="text-destructive">{falseTaps}</span> wrong
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2.5" role="group" aria-label="The row to search">
        {row.row.map((g, i) => (
          <button
            key={`${row.id}:${i}`}
            type="button"
            data-testid="cog-speed-cell"
            onClick={() => tap(i)}
            className={cn(
              "menu-item relative flex h-[72px] items-center justify-center rounded-md border-2 border-foreground/10 bg-shade/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]",
              marks[i] === "hit" && "border-success bg-success/15",
              marks[i] === "miss" && "border-destructive bg-destructive/15"
            )}
          >
            <GlyphView glyph={g} size={52} />
            <kbd className="absolute right-1.5 top-1 hidden font-pixel text-[10px] text-muted-foreground sm:inline" aria-hidden>
              {i + 1}
            </kbd>
          </button>
        ))}
      </div>
      <div className="flex justify-center">
        <Button variant="outline" size="sm" onClick={advance} data-testid="cog-speed-skip">
          <SkipForward className="h-4 w-4" aria-hidden /> Skip row
        </Button>
      </div>
    </div>
  );
}
