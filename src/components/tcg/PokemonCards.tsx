"use client";

import { useEffect, useState } from "react";
import Link from "@/components/ui/Link";
import type { CardTile } from "@/lib/tcg/types";
import { HudHeading } from "@/components/game/HudHeading";
import { CardGrid, gridText } from "./CardGrid";
import { localPriceNote } from "./price-note";
import { useT } from "@/i18n/client";
import tcgCards from "@/messages/tcg-cards";

/**
 * "Cards" section on a Pokémon's page. The page itself is static, so the
 * cards load from /api/tcg (cached daily) once the section is near view.
 * Hidden when the species has no cards or the API is unreachable.
 */
export function PokemonCards({ dex, name }: { dex: number; name: string }) {
  const [data, setData] = useState<{ cards: CardTile[]; total: number; priceNote?: string } | null>(null);
  const [el, setEl] = useState<HTMLElement | null>(null);
  const t = useT(tcgCards);

  useEffect(() => {
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        fetch(`/api/tcg/pokemon/${dex}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => !cancelled && d && setData(d))
          .catch(() => {});
      },
      { rootMargin: "600px" }
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [el, dex]);

  const empty = data && data.cards.length === 0;
  return (
    <section ref={setEl} id="cards" className={empty ? "hidden" : "mx-auto mt-10 max-w-6xl scroll-mt-32 space-y-4"} aria-labelledby="cards-title" data-testid="pokemon-cards">
      {data && data.cards.length > 0 && (
        <>
          <HudHeading
            id="cards-title"
            title={t("pokemon.title")}
            aside={
              <Link href={`/pokedex/tcg?dex=${dex}`} className="text-screen hover:underline" data-testid="pokemon-cards-all">
                {t("pokemon.all", { n: data.total })}
              </Link>
            }
          />
          <CardGrid tiles={data.cards} showSet text={gridText(t)} />
          <p className="text-center text-xs text-muted-foreground">
            {/* The API's note is English: another language words it from the tiles (prices' labels stay the API's). */}
            {t("pokemon.newest", { name, note: (process.env.LIVE_LOCALES && t.locale !== "en" ? localPriceNote(data.cards, t) : data.priceNote) ?? "" })}
          </p>
        </>
      )}
    </section>
  );
}
