/* eslint-disable @next/next/no-img-element -- set logos are hot-linked from the TCG API's image CDN */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList, itemList } from "@/lib/structured-data";
import { DetailHero, DetailNav, StatBox } from "@/components/pokedex/detail/DetailParts";
import { SetGallery } from "@/components/tcg/SetGallery";
import { TcgUnavailable } from "@/components/tcg/TcgUnavailable";
import { kindNames, pageIntl, pageTiles } from "@/components/tcg/local";
import { localPriceNote } from "@/components/tcg/price-note";
import { getSet, getSetCards, getSets } from "@/lib/tcg/api";
import { pagerFor, tcgSetOrder } from "@/lib/dex/neighbours";
import { formatApiDate, formatPrice, headlinePrice, tilePriceNote } from "@/lib/tcg/prices";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import tcg from "@/messages/tcg";
import tcgCards from "@/messages/tcg-cards";

/**
 * Rendered on a set's first visit and then served from the cache (refreshed
 * every 6 hours: prices move about daily), so crawlers going through the
 * TCG sitemaps don't render every page again on each visit.
 */
export const revalidate = 21600;
export function generateStaticParams() {
  return [];
}

interface PageProps {
  params: Promise<{ setId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const set = await getSet((await params).setId);
  const t = serverT(tcg);
  if (!set) return { title: t("meta.setFallback") };
  const date = formatApiDate(set.releaseDate, pageIntl());
  return pageMetadata({
    title: t("meta.setTitle", { name: set.name }),
    description: t("meta.setDescription", { name: set.name, series: set.series, released: date ? t("meta.setReleased", { date }) : "", cards: set.total ? t("meta.setCards", { n: set.total }) : "" }),
    path: `/pokedex/tcg/${set.id}`,
    socialTitle: t("meta.social", { name: set.name }),
    // The preview picture is this segment's opengraph-image (the set's logo on the site's 1200 × 630 card).
  });
}

export default async function SetPage({ params }: PageProps) {
  const { setId } = await params;
  const [set, cards, sets] = await Promise.all([getSet(setId), getSetCards(setId), getSets()]);
  if (!set) {
    if (cards === null) return <TcgUnavailable what="set" />;
    notFound();
  }
  const t = serverT(tcg);
  const intl = pageIntl();
  const tiles = pageTiles(cards ?? []);
  const top = (cards ?? [])
    .map((c) => ({ c, p: headlinePrice(c) }))
    .filter((x) => x.p?.currency === "USD")
    .sort((a, b) => b.p!.value - a.p!.value)[0];
  const date = formatApiDate(set.releaseDate, intl);
  const pager = pagerFor(tcgSetOrder(sets ?? []), (s) => s.id === set.id, (s) => ({ href: `/pokedex/tcg/${s.id}`, label: s.name }));
  const kinds = kindNames(tiles);
  const localKinds = kinds ? { kindNames: kinds } : {};
  const note = getLocale() === "en" ? tilePriceNote(tiles) : localPriceNote(tiles, serverT(tcgCards));

  const crumbs = breadcrumbList([
    { name: t("crumbs.pokedex"), path: "/pokedex" },
    { name: t("crumbs.tcg"), path: "/pokedex/tcg" },
    { name: set.name, path: `/pokedex/tcg/${set.id}` },
  ]);
  const list = itemList(
    t("crumbs.cardList", { name: set.name }),
    (cards ?? []).map((c) => ({ name: `${c.name}${c.number ? ` #${c.number}` : ""}`, path: `/pokedex/tcg/card/${c.id}` }))
  );

  return (
    <article className="mx-auto max-w-6xl space-y-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(crumbs) }} />
      {cards && cards.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(list) }} />}
      <DetailNav tab="tcg" label={t("set.allSets")} pager={pager} />
      <DetailHero
        kicker={t("set.kicker", { series: set.series })}
        title={set.name}
        media={
          set.images?.logo ? (
            <span className="flex h-28 w-full shrink-0 items-center justify-center rounded-md bg-shade/30 p-3 sm:w-56">
              <img src={set.images.logo} alt={t("index.logo", { name: set.name })} className="max-h-full max-w-full object-contain drop-shadow" />
            </span>
          ) : undefined
        }
      >
        <div className="flex flex-wrap gap-2">
          {date && <StatBox label={t("set.released")} value={date} />}
          {set.total ? <StatBox label={t("set.cards")} value={set.printedTotal && set.printedTotal !== set.total ? t("set.secret", { total: set.total, printed: set.printedTotal }) : set.total} /> : null}
          {set.ptcgoCode && <StatBox label={t("set.code")} value={set.ptcgoCode} />}
          {top && <StatBox label={t("set.topCard")} value={<span className="text-base">{top.c.name} · {formatPrice(top.p!.value, "USD", intl)}</span>} />}
          {set.images?.symbol && (
            <span className="flex items-center rounded-md border border-foreground/10 bg-shade/30 px-3">
              <img src={set.images.symbol} alt={t("set.symbol", { name: set.name })} className="h-8 w-8 object-contain" />
            </span>
          )}
        </div>
      </DetailHero>
      {cards === null ? (
        <TcgUnavailable what="setCards" />
      ) : (
        <ClientMessages namespaces={[tcgCards]}>
          <SetGallery tiles={tiles} {...localKinds} />
        </ClientMessages>
      )}
      <p className="text-center text-xs text-muted-foreground" data-testid="tcg-price-note">
        {t("set.priceNote", { note: note || t("set.noPrices") })}
      </p>
    </article>
  );
}
