/* eslint-disable @next/next/no-img-element -- card scans are hot-linked from the TCG API's own image CDN */
import Link from "next/link";
import type { CardTile } from "@/lib/tcg/types";
import { formatPrice } from "@/lib/tcg/prices";
import { cn } from "@/lib/utils";

/** Responsive grid of card scans; each links to the card's page. */
export function CardGrid({ tiles, showSet = false, className }: { tiles: CardTile[]; showSet?: boolean; className?: string }) {
  return (
    <ul className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6", className)} data-testid="tcg-card-grid">
      {tiles.map((t, i) => (
        <li key={t.id}>
          <Link
            href={`/pokedex/tcg/card/${t.id}`}
            data-testid="tcg-card"
            className="group block h-full overflow-hidden rounded-lg border bg-card p-2 transition-colors hover:border-screen/60"
          >
            <div className="relative aspect-[245/342] overflow-hidden rounded-[4.5%/3.2%] bg-shade/40">
              {t.image ? (
                <img
                  src={t.image}
                  alt={`${t.name} card`}
                  loading={i < 6 ? "eager" : "lazy"}
                  decoding="async"
                  width={245}
                  height={342}
                  className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.03]"
                />
              ) : (
                <span className="flex h-full items-center justify-center p-2 text-center font-pixel text-[9px] uppercase text-muted-foreground">No image</span>
              )}
            </div>
            <div className="mt-2 space-y-1 px-0.5">
              <div className="truncate font-display text-sm font-bold uppercase tracking-wide group-hover:text-screen">{t.name}</div>
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span className="truncate">
                  {showSet && t.setName ? `${t.setName} · ` : ""}
                  {t.number && `#${t.number}`}
                </span>
                {t.price && (
                  <span className="shrink-0 font-mono font-semibold tabular-nums text-foreground" title={`${t.price.label}${t.price.currency === "EUR" ? " (Cardmarket)" : " (TCGplayer market)"}`}>
                    {formatPrice(t.price.value, t.price.currency)}
                  </span>
                )}
              </div>
              {t.rarity && <div className="truncate font-pixel text-[9px] uppercase tracking-wider text-muted-foreground/80">{t.rarity}</div>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function TcgUnavailable({ what = "Card data" }: { what?: string }) {
  return (
    <div className="hud rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground" data-testid="tcg-unavailable">
      {what} from the Pokémon TCG API is unavailable right now. Please try again in a few minutes.
    </div>
  );
}
