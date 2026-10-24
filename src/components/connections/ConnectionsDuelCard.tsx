"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { CONN_DUEL_PENALTY_MS, pvpHref } from "@/lib/pvp-types";
import { CONN_MAX_MISTAKES, CONN_SIZES, type ConnSize } from "@/lib/connections/types";
import { NewDuelCard } from "@/components/duel/NewDuelCard";

const MATCH = { game: "connections" };

/**
 * "Duel a friend" on /connections: opens a PokéConnections race and goes to
 * its lobby, or finds an opponent searching right now.
 */
export function ConnectionsDuelCard() {
  const [size, setSize] = useState<ConnSize>(4);
  const body = useMemo(() => ({ kind: "connections", size }), [size]);
  return (
    <NewDuelCard
      body={body}
      href={(code) => pvpHref("connections", code)}
      // Matchmaking pairs 4×4 boards only.
      match={size === 4 ? MATCH : undefined}
      heading="Head to head · PokéConnections"
      blurb={size === 5 ? "The same twenty-five Pokémon for both of you. The first to find all five groups wins." : "The same sixteen Pokémon for both of you. The first to find all four groups wins."}
      info={
        <>
          <p>
            Each mistake adds {CONN_DUEL_PENALTY_MS / 1000} seconds to your time, and {size === 5 ? 5 : CONN_MAX_MISTAKES} mistakes put you out. If you&apos;re both out, more groups found wins. You see your
            opponent&apos;s groups as colours as they find them, never which Pokémon.
          </p>
          <p>Send a friend the link, or find an opponent (4×4 only). Duels use fresh puzzles, never the daily, and never count toward your streak.</p>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <span className="hud-label">Board</span>
        <div className="flex gap-1" role="radiogroup" aria-label="Duel board size" data-testid="conn-duel-size">
          {CONN_SIZES.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={size === n}
              data-testid={`conn-duel-size-${n}`}
              title={n === 4 ? "Sixteen Pokémon, four groups of four" : "Twenty-five Pokémon, five groups of five"}
              onClick={() => setSize(n)}
              className={cn(
                "h-8 rounded-sm border px-2.5 font-pixel text-[10px] uppercase tracking-wider transition-colors",
                size === n ? "border-primary bg-primary text-primary-foreground" : "border-foreground/10 bg-shade/20 text-muted-foreground hover:border-primary/50 hover:text-foreground"
              )}
            >
              {n}×{n}
            </button>
          ))}
        </div>
      </div>
    </NewDuelCard>
  );
}
