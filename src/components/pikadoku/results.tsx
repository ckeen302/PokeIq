"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Check, X } from "lucide-react";
import { spriteUrl } from "@/lib/pokemon/art";
import { RARITY_EMOJI, RARITY_LABEL, type RarityLetter } from "@/lib/pikadoku/share";
import type { PdkGridView, PdkReveal } from "@/lib/pikadoku/types";
import { cn } from "@/lib/utils";

/** Pikadoku's end-of-game pieces: the next-puzzle countdown, the share-card preview, the answers reveal and the guess toast. */

function msToLocalMidnight(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
}
const hms = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** "Next Pikadoku in 4:12:09": the next daily arrives at the player's local midnight. */
export function NextPuzzleCountdown({ className }: { className?: string }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(msToLocalMidnight());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <p className={cn("text-sm text-muted-foreground", className)} data-testid="pdk-countdown">
      Next Pikadoku in <b className="inline-block min-w-[4.5rem] text-left font-display tabular-nums text-foreground">{left === null ? "–:––:––" : hms(left)}</b>
    </p>
  );
}

/** The colours the share text will carry, with what each means. */
export function RarityPreview({ grid }: { grid: string }) {
  const letters = [...grid] as RarityLetter[];
  const used = (["p", "b", "g", "y", "x"] as RarityLetter[]).filter((l) => letters.includes(l));
  return (
    <div className="flex flex-col items-center gap-2" data-testid="pdk-rarity-preview">
      <div className="grid grid-cols-3 gap-1 text-2xl leading-none" aria-hidden>
        {letters.map((l, i) => (
          <span key={i}>{RARITY_EMOJI[l]}</span>
        ))}
      </div>
      <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {used.map((l) => (
          <li key={l}>
            {RARITY_EMOJI[l]} {RARITY_LABEL[l]}
            {l !== "x" && " picked it"}
          </li>
        ))}
      </ul>
    </div>
  );
}

const SHOWN = 12;

/** Every valid answer per cell, rarest first when the stats are on, your pick marked; misses explained. */
export function RevealGrid({ reveal, grid, locked }: { reveal: PdkReveal; grid: PdkGridView | null; locked: Record<number, { id: number; pct: number | null } | undefined> }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  return (
    <section className="space-y-3" aria-label="Answers" data-testid="pdk-reveal">
      <div>
        <h2 className="font-display text-xl font-bold uppercase">All the answers</h2>
        <p className="text-xs text-muted-foreground">Every Pokémon that fits each cell{reveal.cells.some((c) => c.answers.some((a) => a.pct !== null)) ? ", rarest picks first, with the share of players who chose it" : ""}.</p>
      </div>
      {reveal.misses.length > 0 && (
        <ul className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" data-testid="pdk-misses">
          {reveal.misses.map((m, i) => (
            <li key={i} className="flex items-start gap-2">
              <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <span>{m.reason}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        {reveal.cells.map((c, i) => {
          const mine = locked[i];
          const all = open.has(i);
          const answers = all ? c.answers : c.answers.slice(0, SHOWN);
          return (
            <div key={i} className="min-w-0 rounded-md border border-foreground/10 bg-card p-3" data-testid={`pdk-reveal-${i}`}>
              <p className="text-xs font-bold uppercase tracking-wide">
                {grid?.rows[Math.floor(i / 3)].label} × {grid?.cols[i % 3].label}
              </p>
              <p className="mb-2 text-xs text-muted-foreground">{c.total} valid</p>
              {mine ? (
                <p className="mb-2 flex items-center gap-2 rounded border border-success/50 bg-success/10 px-2 py-1 text-sm font-semibold">
                  <Check className="h-4 w-4 shrink-0 text-success" aria-hidden />
                  <Image src={spriteUrl(mine.id)} alt="" width={28} height={28} unoptimized className="h-7 w-7 shrink-0" style={{ imageRendering: "pixelated" }} />
                  <span className="min-w-0 truncate">{c.answers.find((a) => a.id === mine.id)?.name ?? `#${mine.id}`}</span>
                  {mine.pct !== null && <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{mine.pct}%</span>}
                </p>
              ) : (
                <p className="mb-2 rounded border border-dashed border-foreground/20 px-2 py-1 text-sm text-muted-foreground">Not filled</p>
              )}
              <ul className="flex flex-wrap gap-1 text-xs">
                {answers.map((a) => (
                  <li key={a.id} className={cn("rounded border px-1.5 py-0.5", mine?.id === a.id ? "border-primary bg-primary/15 font-bold" : "border-foreground/15")}>
                    {a.name}
                    {!!a.pct && <span className="ml-1 tabular-nums text-muted-foreground">{a.pct}%</span>}
                  </li>
                ))}
              </ul>
              {c.answers.length > SHOWN && (
                <button type="button" onClick={() => setOpen((s) => new Set(s).add(i))} hidden={all} className="mt-1.5 text-xs font-semibold text-screen hover:underline">
                  Show all {c.total}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** A guess's verdict, floating above the bottom bar so it is seen wherever the page is scrolled. Never moves the layout. */
export function GuessToast({ toast }: { toast: { text: string; kind: "hit" | "miss" | "info" } | null }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 sm:bottom-10" aria-live="polite">
      {toast && (
        <p
          role="status"
          data-testid="pdk-toast"
          className={cn(
            "flex max-w-md items-center gap-2 rounded-lg border-2 bg-card px-4 py-2.5 text-sm font-semibold shadow-xl",
            toast.kind === "hit" ? "border-success/70" : toast.kind === "miss" ? "border-destructive/70" : "border-warning/70"
          )}
        >
          {toast.kind === "hit" ? <Check className="h-4 w-4 shrink-0 text-success" aria-hidden /> : toast.kind === "miss" ? <X className="h-4 w-4 shrink-0 text-destructive" aria-hidden /> : null}
          {toast.text}
        </p>
      )}
    </div>
  );
}

/** PP as pips: one per guess, filled while unspent. */
export function PpPips({ left, total }: { left: number; total: number }) {
  return (
    <span className="mt-0.5 flex justify-center gap-0.5" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cn("h-1.5 w-1.5 rounded-full", i < left ? (left <= 2 ? "bg-destructive" : "bg-primary") : "bg-foreground/15")} />
      ))}
    </span>
  );
}
