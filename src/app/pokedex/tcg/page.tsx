/* eslint-disable @next/next/no-img-element -- set logos are hot-linked from the TCG API's image CDN */
import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { HudHeading } from "@/components/game/HudHeading";
import { CardGrid, TcgUnavailable } from "@/components/tcg/CardGrid";
import { cardsForDex, cleanSearch, getSets, searchCards } from "@/lib/tcg/api";
import { formatApiDate, groupSetsBySeries, tilePriceNote, toTile } from "@/lib/tcg/prices";
import { getPokemon } from "@/lib/pokemon/pokedex";

// Rendered per request from Next's data cache (sets: weekly, cards: daily), so a deploy never needs the API.
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string; dex?: string }>;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { q, dex } = await searchParams;
  return pageMetadata({
    title: "Pokémon TCG — Every Set, Every Card, Card Prices",
    description: "Every Pokémon Trading Card Game set from Base Set to today, grouped by era, with every card, its rarity and artist, and recent TCGplayer and Cardmarket prices.",
    path: "/pokedex/tcg",
    noindex: Boolean(q || dex),
  });
}

export default async function TcgPage({ searchParams }: PageProps) {
  const { q = "", dex } = await searchParams;
  const term = cleanSearch(q);
  const dexNo = dex ? Number(dex) : NaN;
  const species = Number.isInteger(dexNo) ? getPokemon(dexNo) : undefined;
  const [sets, results] = await Promise.all([
    getSets(),
    species ? cardsForDex(species.id, 250).then((r) => r?.cards ?? null) : term ? searchCards(term) : Promise.resolve(undefined),
  ]);
  const groups = sets ? groupSetsBySeries(sets) : [];
  const resultTiles = results ? results.map(toTile) : [];
  const resultNote = tilePriceNote(resultTiles);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="space-y-4">
        <ListHeader
          kicker={sets ? `Trading Card Game · ${sets.length} sets` : "Trading Card Game"}
          title="Poké"
          accent="dex"
          blurb="Every Pokémon TCG set ever printed, every card in it, and recent market prices from TCGplayer and Cardmarket."
        />
        <DexTabs active="tcg" />
      </div>

      <form action="/pokedex/tcg" method="get" role="search" className="mx-auto flex max-w-xl gap-2" data-testid="tcg-search">
        <label className="relative flex-1">
          <span className="sr-only">Search cards by name</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            name="q"
            type="search"
            defaultValue={term}
            placeholder="Search cards by name, e.g. Charizard"
            maxLength={40}
            className="h-11 w-full rounded-md border border-foreground/15 bg-card pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:border-screen focus:outline-none"
          />
        </label>
        <button type="submit" className="h-11 rounded-md bg-primary px-5 font-pixel text-[10px] uppercase tracking-wider text-primary-foreground hover:brightness-110">
          Search
        </button>
      </form>

      {results !== undefined && (
        <section className="space-y-4" aria-labelledby="tcg-results-title" data-testid="tcg-results">
          <HudHeading
            id="tcg-results-title"
            title={species ? `${species.name} cards` : `Cards named “${term}”`}
            aside={
              <Link href="/pokedex/tcg" className="hover:text-foreground">
                Clear
              </Link>
            }
          />
          {results === null ? (
            <TcgUnavailable />
          ) : results.length ? (
            <>
              <CardGrid tiles={resultTiles} showSet />
              {resultNote && <p className="text-center text-xs text-muted-foreground" data-testid="tcg-price-note">{resultNote}</p>}
            </>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">No cards found.</p>
          )}
          {species && (
            <p className="text-center text-sm">
              <Link href={`/pokemon/${species.slug}`} className="text-screen underline-offset-2 hover:underline">
                {species.name}&apos;s Pokédex entry
              </Link>
            </p>
          )}
        </section>
      )}

      {!sets ? (
        <TcgUnavailable what="The set list" />
      ) : (
        groups.map((g, gi) => (
          <section key={g.series} className="space-y-4" aria-labelledby={`series-${gi}`} data-testid="tcg-series">
            <HudHeading id={`series-${gi}`} index={gi + 1} title={g.series} aside={`${g.sets.length} set${g.sets.length === 1 ? "" : "s"}`} />
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {g.sets.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/pokedex/tcg/${s.id}`}
                    data-testid="tcg-set"
                    className="group flex h-full flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:border-screen/60"
                  >
                    <div className="flex h-24 items-center justify-center bg-shade/30 p-3 sm:h-28">
                      {s.images?.logo ? (
                        <img src={s.images.logo} alt={`${s.name} logo`} loading={gi === 0 ? "eager" : "lazy"} decoding="async" className="max-h-full max-w-full object-contain drop-shadow transition-transform duration-300 group-hover:scale-105" />
                      ) : (
                        <span className="font-display text-lg font-bold uppercase">{s.name}</span>
                      )}
                    </div>
                    <div className="flex flex-1 items-start gap-2 border-t border-foreground/[0.07] p-3">
                      {s.images?.symbol && <img src={s.images.symbol} alt="" loading="lazy" decoding="async" className="mt-0.5 h-5 w-5 shrink-0 object-contain" />}
                      <div className="min-w-0">
                        <div className="font-display text-sm font-bold uppercase leading-tight tracking-wide group-hover:text-screen">{s.name}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {[formatApiDate(s.releaseDate), s.total ? `${s.total} cards` : null].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <p className="text-center text-xs text-muted-foreground">
        Card data and images from the{" "}
        <a href="https://pokemontcg.io" className="underline-offset-2 hover:underline" rel="noopener" target="_blank">
          Pokémon TCG API
        </a>
        ; prices from it, or TCGplayer via{" "}
        <a href="https://tcgcsv.com" className="underline-offset-2 hover:underline" rel="noopener" target="_blank">
          TCGCSV
        </a>{" "}
        and Cardmarket via{" "}
        <a href="https://tcgdex.dev" className="underline-offset-2 hover:underline" rel="noopener" target="_blank">
          TCGdex
        </a>
        . Not affiliated with The Pokémon Company.
      </p>
    </div>
  );
}
