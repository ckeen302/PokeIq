/* eslint-disable @next/next/no-img-element -- set logos are hot-linked from the TCG API's image CDN */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SHARE_IMAGES, jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList, itemList } from "@/lib/structured-data";
import { DetailHero, DetailNav, StatBox } from "@/components/pokedex/detail/DetailParts";
import { SetGallery } from "@/components/tcg/SetGallery";
import { TcgUnavailable } from "@/components/tcg/CardGrid";
import { getSet, getSetCards } from "@/lib/tcg/api";
import { formatApiDate, formatPrice, headlinePrice, tilePriceNote, toTile } from "@/lib/tcg/prices";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ setId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const set = await getSet((await params).setId);
  if (!set) return { title: "Pokémon TCG set" };
  const date = formatApiDate(set.releaseDate);
  return pageMetadata({
    title: `${set.name} — Pokémon TCG Set List & Card Prices`,
    description: `Every card in the ${set.name} Pokémon TCG set (${set.series} series${date ? `, released ${date}` : ""}${set.total ? `, ${set.total} cards` : ""}), sortable by number, rarity and current market price.`,
    path: `/pokedex/tcg/${set.id}`,
    socialTitle: `${set.name} · PokéIQ TCG`,
    image: set.images?.logo ? { url: set.images.logo, alt: `${set.name} logo` } : SHARE_IMAGES.pokedex,
  });
}

export default async function SetPage({ params }: PageProps) {
  const { setId } = await params;
  const [set, cards] = await Promise.all([getSet(setId), getSetCards(setId)]);
  if (!set) {
    if (cards === null) return <TcgUnavailable what="This set" />;
    notFound();
  }
  const tiles = (cards ?? []).map(toTile);
  const top = (cards ?? [])
    .map((c) => ({ c, p: headlinePrice(c) }))
    .filter((x) => x.p?.currency === "USD")
    .sort((a, b) => b.p!.value - a.p!.value)[0];
  const date = formatApiDate(set.releaseDate);

  const crumbs = breadcrumbList([
    { name: "Pokédex", path: "/pokedex" },
    { name: "Pokémon TCG", path: "/pokedex/tcg" },
    { name: set.name, path: `/pokedex/tcg/${set.id}` },
  ]);
  const list = itemList(
    `${set.name} card list`,
    (cards ?? []).map((c) => ({ name: `${c.name}${c.number ? ` #${c.number}` : ""}`, path: `/pokedex/tcg/card/${c.id}` }))
  );

  return (
    <article className="mx-auto max-w-6xl space-y-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(crumbs) }} />
      {cards && cards.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(list) }} />}
      <DetailNav tab="tcg" label="All sets" />
      <DetailHero
        kicker={`TCG set · ${set.series}`}
        title={set.name}
        media={
          set.images?.logo ? (
            <span className="flex h-28 w-full shrink-0 items-center justify-center rounded-md bg-shade/30 p-3 sm:w-56">
              <img src={set.images.logo} alt={`${set.name} logo`} className="max-h-full max-w-full object-contain drop-shadow" />
            </span>
          ) : undefined
        }
      >
        <div className="flex flex-wrap gap-2">
          {date && <StatBox label="Released" value={date} />}
          {set.total ? <StatBox label="Cards" value={set.printedTotal && set.printedTotal !== set.total ? `${set.total} (${set.printedTotal} + secret)` : set.total} /> : null}
          {set.ptcgoCode && <StatBox label="Code" value={set.ptcgoCode} />}
          {top && <StatBox label="Top card" value={<span className="text-base">{top.c.name} · {formatPrice(top.p!.value, "USD")}</span>} />}
          {set.images?.symbol && (
            <span className="flex items-center rounded-md border border-foreground/10 bg-shade/30 px-3">
              <img src={set.images.symbol} alt={`${set.name} set symbol`} className="h-8 w-8 object-contain" />
            </span>
          )}
        </div>
      </DetailHero>
      {cards === null ? <TcgUnavailable what="This set's cards" /> : <SetGallery tiles={tiles} />}
      <p className="text-center text-xs text-muted-foreground" data-testid="tcg-price-note">
        {tilePriceNote(tiles) || "No market prices are listed for this set yet."} Updated about daily.
      </p>
    </article>
  );
}
