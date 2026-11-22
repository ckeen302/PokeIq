"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { CONN_DUEL_PENALTY_MS, pvpHref } from "@/lib/pvp-types";
import { CONN_MAX_MISTAKES, CONN_SIZES, type ConnSize } from "@/lib/connections/types";
import { NewDuelCard } from "@/components/duel/NewDuelCard";
import { useT } from "@/i18n/client";
import cards from "@/messages/connections-cards";

const MATCH = { game: "connections" };

/**
 * "Duel a friend" on /pokeconnections: opens a PokéConnections race and goes to
 * its lobby, or finds an opponent searching right now.
 */
export function ConnectionsDuelCard() {
  const t = useT(cards);
  const [size, setSize] = useState<ConnSize>(4);
  const body = useMemo(() => ({ kind: "connections", size }), [size]);
  return (
    <NewDuelCard
      body={body}
      href={(code) => pvpHref("connections", code)}
      // Matchmaking pairs 4×4 boards only.
      match={size === 4 ? MATCH : undefined}
      heading={t("duel.heading")}
      blurb={t(size === 5 ? "duel.blurb5" : "duel.blurb4")}
      info={
        <>
          <p>{t("duel.rules", { seconds: CONN_DUEL_PENALTY_MS / 1000, mistakes: size === 5 ? 5 : CONN_MAX_MISTAKES })}</p>
          <p>{t("duel.fresh")}</p>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <span className="hud-label">{t("duel.board")}</span>
        <div className="flex gap-1" role="radiogroup" aria-label={t("duel.boardAria")} data-testid="conn-duel-size">
          {CONN_SIZES.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={size === n}
              data-testid={`conn-duel-size-${n}`}
              title={t(n === 4 ? "duel.size4" : "duel.size5")}
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
