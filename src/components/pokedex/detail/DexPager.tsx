import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Pager, PagerLink } from "@/lib/dex/neighbours";
import { PagerKeys } from "./PagerKeys";

/**
 * "‹ Previous · Pokédex · Next ›" row at the top of every Pokédex entry
 * (Pokémon, moves, places, cards…). Plain links, so it works without JS and
 * crawlers follow it; ← / → do the same from the keyboard.
 */
export function DexPager({ prev, next, center = { href: "/pokedex", label: "Pokédex" } }: Pager & { center?: PagerLink }) {
  return (
    <nav aria-label="Previous and next" data-testid="dex-pager" className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 text-sm text-muted-foreground">
      {prev ? (
        <Link href={prev.href} rel="prev" data-testid="dex-prev" className="flex min-w-0 items-center gap-1 justify-self-start hover:text-foreground">
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
          <span className="sr-only">Previous: </span>
          <span className="line-clamp-2 break-words">{prev.label}</span>
        </Link>
      ) : (
        <span />
      )}
      <Link href={center.href} className="text-center hover:text-foreground">
        {center.label}
      </Link>
      {next ? (
        <Link href={next.href} rel="next" data-testid="dex-next" className="flex min-w-0 items-center gap-1 justify-self-end text-right hover:text-foreground">
          <span className="sr-only">Next: </span>
          <span className="line-clamp-2 break-words">{next.label}</span>
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        </Link>
      ) : (
        <span />
      )}
      <PagerKeys prev={prev?.href} next={next?.href} />
    </nav>
  );
}
