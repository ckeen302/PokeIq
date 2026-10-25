"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";

/** What every game's "How to play" pop-up shares: the looping demo's clock, its frame, the rule cards and the two buttons. */

/**
 * Steps through a demo's frames (each held for its `ms`), looping. Under
 * reduced motion it never moves: it stays on the last frame, a still picture of the result.
 */
export function useDemoFrame(ms: readonly number[]): number {
  const reduced = useReducedMotion();
  const last = ms.length - 1;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduced) return;
    setI(0);
    let n = 0;
    let t = 0;
    const tick = () => {
      t = window.setTimeout(() => {
        n = (n + 1) % ms.length;
        setI(n);
        tick();
      }, ms[n]);
    };
    tick();
    return () => window.clearTimeout(t);
  }, [reduced, ms]);
  return reduced ? last : i;
}

export function DemoFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div data-testid="howto-demo" role="group" aria-label={label} className="overflow-hidden rounded-md border-2 border-foreground/15 bg-shade/40 p-3">
      <p className="hud-label mb-2 flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-destructive" aria-hidden /> Demo
      </p>
      <div aria-hidden>{children}</div>
    </div>
  );
}

export interface HowToCard {
  title: string;
  body: React.ReactNode;
}

export function HowToCards({ cards }: { cards: HowToCard[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {cards.map((c) => (
        <div key={c.title} className="rounded-md border-2 border-foreground/10 bg-card p-3">
          <p className="hud-label mb-1">{c.title}</p>
          <div className="space-y-1 text-sm">{c.body}</div>
        </div>
      ))}
    </div>
  );
}

/** "Let's play!" closes; "Don't show again" closes and stops the automatic first-visit pop-up on this device. */
export function HowToActions({ onClose, onNever }: { onClose: () => void; onNever?: () => void }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row-reverse">
      <Button className="w-full sm:flex-1" onClick={onClose} data-testid="howto-play">
        Let&apos;s play!
      </Button>
      {onNever && (
        <Button variant="outline" className="w-full sm:flex-1" onClick={onNever} data-testid="howto-never">
          Don&apos;t show again
        </Button>
      )}
    </div>
  );
}
