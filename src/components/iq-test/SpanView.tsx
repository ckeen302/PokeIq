"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Undo2 } from "lucide-react";
import { monName } from "@/lib/cognitive/materials";
import type { SpanItem } from "@/lib/cognitive/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MonSprite } from "./CellView";

/**
 * A sprite span: the sequence plays one Pokémon at a time, then the grid
 * appears and the trainer taps them back in order (or in reverse). The
 * answer is in once as many are tapped as were shown.
 */
export function SpanView({ item, showMs, onAnswer, onRecallStart }: { item: SpanItem; showMs: number; onAnswer: (taps: number[]) => void; onRecallStart: () => void }) {
  const [shown, setShown] = useState(0); // 1-based index of the sprite on screen; 0 before, > length when done
  const [taps, setTaps] = useState<number[]>([]);
  const recalling = shown > item.sequence.length;

  useEffect(() => {
    setShown(0);
    setTaps([]);
    let i = 0;
    const gap = Math.max(60, Math.round(showMs * 0.3));
    const timers: number[] = [];
    const next = () => {
      i++;
      setShown(i);
      if (i > item.sequence.length) {
        onRecallStart();
        return;
      }
      timers.push(window.setTimeout(() => setShown(-i), showMs));
      timers.push(window.setTimeout(next, showMs + gap));
    };
    timers.push(window.setTimeout(next, 500));
    return () => timers.forEach((t) => clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new item restarts the sequence; the callbacks are stable for its life
  }, [item.id, showMs]);

  // Keys 1–9 tap grid cells.
  useEffect(() => {
    if (!recalling) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[1-9]$/.test(e.key)) tap(Number(e.key) - 1);
      if (e.key === "Backspace") setTaps((t) => t.slice(0, -1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tap closes over the latest taps through setState
  }, [recalling, taps.length]);

  function tap(i: number) {
    if (taps.includes(i) || taps.length >= item.sequence.length) return;
    const next = [...taps, i];
    setTaps(next);
    if (next.length === item.sequence.length) setTimeout(() => onAnswer(next), 250);
  }

  const current = shown > 0 && shown <= item.sequence.length ? item.sequence[shown - 1] : null;

  if (!recalling) {
    return (
      <div className="flex flex-col items-center gap-3" data-testid="cog-span-show">
        <p className="hud-label text-muted-foreground">Watch · {item.sequence.length} Pokémon</p>
        <div className="screen flex h-44 w-44 items-center justify-center rounded-md">
          <AnimatePresence mode="wait">
            {current !== null && (
              <motion.div key={shown} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.12 }} className="relative z-[3]">
                <MonSprite id={current} size={140} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="flex gap-1.5" aria-hidden>
          {item.sequence.map((_, i) => (
            <span key={i} className={cn("h-2 w-2 rounded-full", i < Math.abs(shown) ? "bg-screen" : "bg-foreground/15")} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="cog-span-recall">
      <p className="text-center font-display text-lg font-semibold uppercase tracking-wide">
        Tap them {item.reverse ? <span className="text-primary">in reverse order</span> : "in order"} <span className="text-muted-foreground">({taps.length}/{item.sequence.length})</span>
      </p>
      <div className="mx-auto grid max-w-[330px] grid-cols-3 gap-2" role="group" aria-label="The Pokémon to tap">
        {item.grid.map((id, i) => {
          const at = taps.indexOf(i);
          return (
            <button
              key={id}
              type="button"
              data-testid="cog-span-cell"
              onClick={() => tap(i)}
              disabled={at >= 0}
              aria-label={monName(id)}
              className={cn(
                "menu-item relative flex aspect-square items-center justify-center rounded-md border-2 border-foreground/10 bg-shade/30 p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                at >= 0 ? "border-screen bg-screen/15" : "hover:border-screen/60 active:scale-[0.97]"
              )}
            >
              <MonSprite id={id} size={76} />
              {at >= 0 && <span className="absolute left-1.5 top-1 rounded-sm bg-screen px-1.5 font-pixel text-[11px] text-background">{at + 1}</span>}
              <kbd className="absolute right-1.5 top-1 hidden font-pixel text-[10px] text-muted-foreground sm:inline" aria-hidden>
                {i + 1}
              </kbd>
            </button>
          );
        })}
      </div>
      <div className="flex justify-center">
        <Button variant="ghost" size="sm" onClick={() => setTaps((t) => t.slice(0, -1))} disabled={taps.length === 0}>
          <Undo2 className="h-4 w-4" aria-hidden /> Undo
        </Button>
      </div>
    </div>
  );
}
