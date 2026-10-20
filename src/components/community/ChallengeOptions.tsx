"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Compass, Loader2, Search, Settings2, Swords, Zap } from "lucide-react";
import { challengeToDuel, challengeToLiveBattle } from "@/lib/friends-client";
import { MODULE_INFO, PLAY_MODULES } from "@/lib/modes";
import type { ModuleId } from "@/engines/types";
import { cn } from "@/lib/utils";

/**
 * Challenge a friend: each choice opens the game through its usual invite
 * flow (as "Battle a friend" or "Duel a friend" would), sends the friend the
 * challenge, and takes you to the lobby to wait for them.
 */
export function ChallengeOptions({ friend, me, onDone, className }: { friend: string; me: string; onDone?: () => void; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<ModuleId>("whos-that");

  async function go(id: string, open: () => Promise<string>) {
    setBusy(id);
    setError(null);
    try {
      const href = await open();
      onDone?.();
      router.push(href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the challenge.");
      setBusy(null);
    }
  }

  const item = "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent disabled:opacity-50";
  const spin = (id: string, icon: React.ReactNode) => (busy === id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon);
  return (
    <div className={cn("mt-2 space-y-0.5 border-t pt-2", className)} data-testid="challenge-options">
      <button type="button" className={item} disabled={!!busy} onClick={() => void go("random", () => challengeToLiveBattle(friend, me))}>
        {spin("random", <Zap className="h-4 w-4 text-primary" aria-hidden />)} Random Battle
      </button>
      <button
        type="button"
        className={item}
        disabled={!!busy}
        onClick={() => (onDone?.(), router.push(`/battle/play?challenge=${encodeURIComponent(friend)}`))}
      >
        <Settings2 className="h-4 w-4 text-primary" aria-hidden /> Battle: any format or custom rules…
      </button>
      <button type="button" className={item} disabled={!!busy} onClick={() => void go("pokedle", () => challengeToDuel(friend, me, { kind: "pokedle" }))}>
        {spin("pokedle", <Search className="h-4 w-4 text-primary" aria-hidden />)} Pokédle duel
      </button>
      <button type="button" className={item} disabled={!!busy} onClick={() => void go("guessr", () => challengeToDuel(friend, me, { kind: "guessr" }))}>
        {spin("guessr", <Compass className="h-4 w-4 text-primary" aria-hidden />)} PokéGuessr duel
      </button>
      <div className="flex items-center gap-2 px-2.5 py-1">
        <button type="button" className="flex items-center gap-2 text-sm hover:underline disabled:opacity-50" disabled={!!busy} onClick={() => void go("quiz", () => challengeToDuel(friend, me, { kind: "quiz", module: quiz }))}>
          {spin("quiz", <Swords className="h-4 w-4 text-primary" aria-hidden />)} Quiz duel:
        </button>
        <select aria-label="Quiz mode" value={quiz} onChange={(e) => setQuiz(e.target.value as ModuleId)} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs">
          {PLAY_MODULES.map((m) => (
            <option key={m} value={m}>
              {MODULE_INFO[m].title}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="px-2.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}
