import { GXE_RD_SHOWN, gxe as gxeOf } from "@/lib/battle/glicko";
import { cn } from "@/lib/utils";

/**
 * A battle ladder rating as Pokémon Showdown shows it: the Glicko-2 rating
 * with its deviation ("1623 ± 54") and GXE, the chance of beating a random
 * trainer on the ladder. While the RD is still large the rating is marked
 * provisional, as Showdown does.
 */
export function GlickoBadge({ rating, rd, gxe, className, size = "md" }: { rating: number; rd?: number; gxe?: number; className?: string; size?: "sm" | "md" | "lg" }) {
  const dev = rd ?? 350;
  const g = gxe ?? gxeOf(rating, dev);
  const provisional = dev >= GXE_RD_SHOWN;
  return (
    <span
      className={cn("inline-flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}
      title={`Glicko-2 rating ${Math.round(rating)} ± ${Math.round(dev)}. GXE ${g.toFixed(1)}%: the chance of beating a random trainer on this ladder.`}
      data-testid="glicko-badge"
    >
      <span className={cn("font-display font-bold tabular-nums", size === "lg" ? "text-3xl" : size === "sm" ? "text-sm" : "text-lg")}>{Math.round(rating)}</span>
      <span className={cn("font-pixel tabular-nums text-muted-foreground", size === "sm" ? "text-[9px]" : "text-[11px]")}>± {Math.round(dev)}</span>
      <span className={cn("rounded-sm bg-screen/15 px-1.5 font-pixel tabular-nums text-screen", size === "sm" ? "text-[9px]" : "text-[11px]")}>GXE {g.toFixed(1)}%</span>
      {provisional && (
        <span className="rounded-sm border border-foreground/15 px-1 font-pixel text-[8px] uppercase text-muted-foreground" title={`Provisional until the rating deviation drops below ${GXE_RD_SHOWN}`}>
          Prov.
        </span>
      )}
    </span>
  );
}
