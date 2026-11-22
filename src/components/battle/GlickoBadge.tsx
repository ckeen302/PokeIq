import { GXE_RD_SHOWN, glickoLabel, gxe as gxeOf } from "@/lib/battle/glicko";
import { cn } from "@/lib/utils";
import { translator, type Translator } from "@/i18n/catalog";
import battleGlicko from "@/messages/battle-glicko";

/** The badge's words in the page's language. */
export type GlickoT = Translator<typeof battleGlicko.en>;

export interface GlickoBadgeProps {
  rating: number;
  rd?: number;
  gxe?: number;
  elo?: number;
  headline?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
}

/**
 * A battle ladder rating as Pokémon Showdown shows it: the Elo first (the
 * headline rating and the ladder's order), then GXE, the chance of beating a
 * random trainer on the ladder, and the Glicko-2 rating with its deviation
 * ("1623 ± 54"). Without an Elo (an older standing) the Glicko-2 rating
 * leads. With `headline` off, the Elo is left out (it has its own column on
 * the ladder) and only GXE and the Glicko-2 rating are shown. While the RD
 * is still large the rating is marked provisional, as Showdown does.
 * In English; a page in another language renders `glickoBadge(props, t)` with its translator.
 */
export function GlickoBadge(props: GlickoBadgeProps) {
  return glickoBadge(props);
}

/** The badge, its words from `t` (serverT or useT of battle-glicko). */
export function glickoBadge(
  { rating, rd, gxe, elo, headline = true, className, size = "md" }: GlickoBadgeProps,
  t: Translator<typeof battleGlicko.en> = translator(battleGlicko, "en", undefined)
) {
  const dev = rd ?? 350;
  const g = gxe ?? gxeOf(rating, dev);
  const provisional = dev >= GXE_RD_SHOWN;
  const glicko = glickoLabel(rating, dev);
  const big = cn("font-display font-bold tabular-nums", size === "lg" ? "text-3xl" : size === "sm" ? "text-sm" : "text-lg");
  const small = cn("font-pixel tabular-nums text-muted-foreground", size === "sm" ? "text-[9px]" : "text-[11px]");
  return (
    <span
      className={cn("inline-flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}
      title={t("title", { elo: elo !== undefined ? String(Math.round(elo)) : "none", gxe: g.toFixed(1), glicko })}
      data-testid="glicko-badge"
    >
      {elo !== undefined ? (
        headline && (
          <span className={big} data-testid="elo">
            {Math.round(elo)}
          </span>
        )
      ) : (
        <>
          <span className={big}>{Math.round(rating)}</span>
          <span className={small}>± {Math.round(dev)}</span>
        </>
      )}
      <span className={cn("rounded-sm bg-screen/15 px-1.5 font-pixel tabular-nums text-screen", size === "sm" ? "text-[9px]" : "text-[11px]")}>{t("gxe", { gxe: g.toFixed(1) })}</span>
      {elo !== undefined && (
        <span className={small} title={t("deviation")}>
          {glicko}
        </span>
      )}
      {provisional && (
        <span className="rounded-sm border border-foreground/15 px-1 font-pixel text-[8px] uppercase text-muted-foreground" title={t("provisionalTitle", { rd: GXE_RD_SHOWN })}>
          {t("provisional")}
        </span>
      )}
    </span>
  );
}
