"use client";

import { useMemo } from "react";
import { Timer } from "lucide-react";
import type { WhoamiMine } from "@/lib/whoami";
import { clock } from "@/components/duel/DuelParts";
import { KnownList, LockPill, PPBar, PokeGrid, QuestionMenu, aliveAbilities, type WhoamiDexEntry } from "./parts";
import { cn } from "@/lib/utils";

/**
 * Where a round is played, solo or in a duel: the grid on the left, the
 * clock, PP, the question menu and what you know on the right. `side`
 * goes above the menu (a duel's clue drop and ability).
 */
export function PlayArea({
  pool,
  mine,
  dex,
  now,
  endsAt,
  done,
  tauntUntil = 0,
  busy,
  side,
  onAsk,
  onGuess,
}: {
  pool: number[];
  mine: WhoamiMine;
  dex: Map<number, WhoamiDexEntry>;
  now: number;
  endsAt: number;
  done: boolean;
  tauntUntil?: number;
  busy: boolean;
  side?: React.ReactNode;
  onAsk: (q: string) => void;
  onGuess: (id: number) => void;
}) {
  const left = endsAt - now;
  const lock = mine.lockUntil > now ? `Locked ${Math.ceil((mine.lockUntil - now) / 1000)}s` : null;
  const taunt = tauntUntil > now ? `Taunted ${Math.ceil((tauntUntil - now) / 1000)}s` : null;
  const abilities = useMemo(() => aliveAbilities(mine.alive, dex), [mine.alive, dex]);
  const closed = done ? "Solved!" : left <= 0 ? "Time's up" : lock ? "Wrong guess: locked out for a moment." : taunt ? "You've been taunted: no questions for a moment." : mine.pp === 0 ? "Out of PP: you can only guess." : busy ? "" : null;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <PokeGrid pool={pool} mine={mine} dex={dex} done={done || left <= 0} locked={lock ?? (busy ? "…" : null)} onGuess={onGuess} />
      <div className="space-y-3 lg:sticky lg:top-20">
        <div className="flex items-center gap-3 rounded-md border bg-card p-3">
          <div className="flex-1">
            <PPBar pp={mine.pp} />
          </div>
          <div className={cn("flex items-center gap-1.5 font-pixel text-lg tabular-nums", left <= 20_000 && left > 0 && "animate-pulse text-warning")} data-testid="whoami-clock">
            <Timer className="h-4 w-4" aria-hidden /> {clock(Math.max(0, left))}
          </div>
        </div>
        {(lock || taunt) && (
          <div className="flex flex-wrap gap-2">
            {lock && <LockPill text={lock} />}
            {taunt && <LockPill text={taunt} />}
          </div>
        )}
        {side}
        <QuestionMenu known={mine.known} pp={mine.pp} disabled={closed || null} abilities={abilities} onAsk={onAsk} />
        <KnownList known={mine.known} />
      </div>
    </div>
  );
}
