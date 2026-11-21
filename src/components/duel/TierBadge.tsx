import { RANKED_PROVISIONAL_GAMES, isProvisional, tierOf, type RankedTierId } from "@/lib/ranked";
import { cn } from "@/lib/utils";

/** The ranked tiers' look: a ball in each tier's colours (ranked PokéGuessr's divisions use them too) and the tier badge a battle ladder rating shows on a profile. */

const fmt = (n: number) => n.toLocaleString("en-US");

const BALL: Record<RankedTierId, { top: string; band?: string; text: string }> = {
  poke: { top: "#e3350d", text: "text-[#e3350d]" },
  great: { top: "#2a75bb", band: "#e3350d", text: "text-[#3b8fe0]" },
  ultra: { top: "#2b2b2b", band: "#f2c12e", text: "text-[#e0b021]" },
  master: { top: "#7a3fb8", band: "#e85aa8", text: "text-[#a368e0]" },
};

/** A ball in the tier's colours. */
export function BallIcon({ tier, className }: { tier: RankedTierId; className?: string }) {
  const b = BALL[tier];
  return (
    <svg viewBox="0 0 32 32" className={cn("h-6 w-6 shrink-0", className)} aria-hidden>
      <path d="M2 16a14 14 0 0 1 28 0Z" fill={b.top} />
      {b.band && tier === "great" && (
        <>
          <path d="M7 7.5 11 12" stroke={b.band} strokeWidth="3" strokeLinecap="round" />
          <path d="M25 7.5 21 12" stroke={b.band} strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {b.band && tier === "ultra" && <path d="M9 4.5v8M23 4.5v8" stroke={b.band} strokeWidth="3.4" strokeLinecap="round" />}
      {b.band && tier === "master" && (
        <>
          <circle cx="9.5" cy="10" r="2.6" fill={b.band} />
          <circle cx="22.5" cy="10" r="2.6" fill={b.band} />
          <text x="16" y="12" textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff">M</text>
        </>
      )}
      <path d="M2 16a14 14 0 0 0 28 0Z" fill="#f4f4f4" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="#1d1d1d" strokeWidth="2" />
      <path d="M2 16h28" stroke="#1d1d1d" strokeWidth="2" />
      <circle cx="16" cy="16" r="4.4" fill="#f4f4f4" stroke="#1d1d1d" strokeWidth="2" />
    </svg>
  );
}

/** "Great Ball II · 1,312": the tier badge, with the rating. */
export function TierBadge({ rating, games, className, size = "md" }: { rating: number; games?: number; className?: string; size?: "sm" | "md" | "lg" }) {
  const t = tierOf(rating);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} title={`${t.label} · ${fmt(rating)} rating`}>
      <BallIcon tier={t.tier} className={size === "lg" ? "h-10 w-10" : size === "sm" ? "h-4 w-4" : "h-6 w-6"} />
      <span className={cn("truncate font-display font-bold uppercase", BALL[t.tier].text, size === "lg" ? "text-2xl" : size === "sm" ? "text-[11px]" : "text-sm")}>{t.label}</span>
      <span className={cn("font-pixel tabular-nums text-muted-foreground", size === "sm" ? "text-[9px]" : "text-xs")}>{fmt(rating)}</span>
      {games !== undefined && isProvisional(games) && (
        <span className="rounded-sm border border-foreground/15 px-1 font-pixel text-[8px] uppercase text-muted-foreground" title={`Provisional: ratings move faster for the first ${RANKED_PROVISIONAL_GAMES} games`}>
          Prov.
        </span>
      )}
    </span>
  );
}
