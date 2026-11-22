/* eslint-disable @next/next/no-img-element -- card scans are hot-linked from the TCG API's image CDN */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "@/components/ui/Link";
import { ExternalLink } from "lucide-react";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { DetailNav, StatBox } from "@/components/pokedex/detail/DetailParts";
import { HudHeading } from "@/components/game/HudHeading";
import { EnergyChip } from "@/components/tcg/EnergyChip";
import { getCard, getSetCardList } from "@/lib/tcg/api";
import { NO_PAGER, pagerFor, tcgCardLabel, tcgCardOrder } from "@/lib/dex/neighbours";
import { cardmarketRows, formatApiDate, formatPrice, headlinePrice, PRICE_SOURCES, tcgplayerRows } from "@/lib/tcg/prices";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { cardmarketLabel, energyName, pageIntl, sourceLine, variantName } from "@/components/tcg/local";
import { speciesName } from "@/lib/names/species";
import { getLocale, serverT } from "@/i18n/server";
import tcgNs from "@/messages/tcg";

/**
 * Rendered on a card's first visit and then served from the cache (refreshed
 * every 6 hours: prices move about daily), so crawlers going through the
 * TCG sitemaps don't render every page again on each visit.
 */
export const revalidate = 21600;
export function generateStaticParams() {
  return [];
}

interface PageProps {
  params: Promise<{ cardId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const card = await getCard((await params).cardId);
  const t = serverT(tcgNs);
  if (!card) return { title: t("meta.cardFallback") };
  const intl = pageIntl();
  const price = headlinePrice(card);
  const where = [card.set?.name, card.number && `#${card.number}`].filter(Boolean).join(" ");
  const asOf = price ? formatApiDate(price.asOf, intl) : null;
  const priced = price ? (asOf ? t("meta.cardPriceAsOf", { price: formatPrice(price.value, price.currency, intl), date: asOf }) : t("meta.cardPrice", { price: formatPrice(price.value, price.currency, intl) })) : "";
  return pageMetadata({
    title: where ? t("meta.cardTitle", { name: card.name, where }) : t("meta.cardTitleBare", { name: card.name }),
    description: t("meta.cardDescription", {
      name: card.name,
      set: card.set?.name ?? t("meta.cardSetFallback"),
      rarity: card.rarity ? t("meta.cardRarity", { rarity: card.rarity }) : "",
      artist: card.artist ? t("meta.cardArtist", { artist: card.artist }) : "",
      price: priced,
    }),
    path: `/pokedex/tcg/card/${card.id}`,
    socialTitle: t("meta.social", { name: card.name }),
    // The preview picture is this segment's opengraph-image (the card's scan on the site's 1200 × 630 card).
  });
}

const cell = (v: number | null, intl: string) => (v === null ? <span className="text-muted-foreground">—</span> : formatPrice(v, "USD", intl));

export default async function CardPage({ params }: PageProps) {
  const { cardId } = await params;
  // Card ids are "<set id>-<number>": fetch the set's card list (for previous / next) alongside the card.
  const setGuess = cardId.includes("-") ? cardId.slice(0, cardId.lastIndexOf("-")) : null;
  const [card, guessedList] = await Promise.all([getCard(cardId), setGuess ? getSetCardList(setGuess) : null]);
  if (!card) {
    // Unknown id vs. the API being down look the same here; a 404 is the honest answer for a bad id.
    notFound();
  }
  const set = card.set;
  const t = serverT(tcgNs);
  const locale = getLocale();
  const intl = pageIntl();
  // Previous / next card in the set, by number (the set gallery's default order).
  const setList = !set ? null : set.id === setGuess ? guessedList : await getSetCardList(set.id);
  const pager = setList ? pagerFor(tcgCardOrder(setList), (c) => c.id === card.id, (c) => ({ href: `/pokedex/tcg/card/${c.id}`, label: tcgCardLabel(c) })) : NO_PAGER;
  const tcg = tcgplayerRows(card);
  const cm = cardmarketRows(card);
  const species = (card.nationalPokedexNumbers ?? []).flatMap((n) => getPokemon(n) ?? []);
  const tcgDate = formatApiDate(card.tcgplayer?.updatedAt, intl);
  const cmDate = formatApiDate(card.cardmarket?.updatedAt, intl);
  const price = headlinePrice(card);
  const tcgSource = sourceLine("TCGplayer", card.priceSources?.tcgplayer, card.tcgplayer?.updatedAt, t);
  const cmSource = sourceLine("Cardmarket", card.priceSources?.cardmarket, card.cardmarket?.updatedAt, t);
  const energy = (type: string) => (locale === "en" ? undefined : energyName(type, t));
  const relays = [card.priceSources?.tcgplayer, card.priceSources?.cardmarket].filter((s, i, a): s is NonNullable<typeof s> => !!s && s !== "pokemontcg" && a.indexOf(s) === i);

  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${card.name}${set ? ` (${set.name} ${card.number ?? ""})` : ""}`.trim(),
    ...(card.images?.large && { image: card.images.large }),
    category: "Pokémon Trading Card",
    ...(price?.currency === "USD" && { offers: { "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: tcg[0]?.low ?? price.value, offerCount: 1, url: card.tcgplayer?.url } }),
  };

  const crumbs = breadcrumbList([
    { name: t("crumbs.pokedex"), path: "/pokedex" },
    { name: t("crumbs.tcg"), path: "/pokedex/tcg" },
    ...(set ? [{ name: set.name, path: `/pokedex/tcg/${set.id}` }] : []),
    { name: card.name, path: `/pokedex/tcg/card/${card.id}` },
  ]);

  return (
    <article className="mx-auto max-w-6xl space-y-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(crumbs) }} />
      {set ? <DetailNav tab={`tcg/${set.id}`} label={set.name} pager={pager} home={{ href: "/pokedex/tcg", label: t("set.allSets") }} /> : <DetailNav tab="tcg" label={t("set.allSets")} />}

      <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,22rem)_1fr] lg:grid-cols-[minmax(0,26rem)_1fr]">
        <div className="mx-auto w-full max-w-sm md:sticky md:top-24 md:max-w-none md:self-start">
          {card.images?.large || card.images?.small ? (
            <a href={card.images.large ?? card.images.small} target="_blank" rel="noopener" className="block">
              <img
                src={card.images.large ?? card.images.small}
                alt={set ? t("card.imageAltSet", { name: card.name, set: set.name }) : t("card.imageAlt", { name: card.name })}
                width={734}
                height={1024}
                data-testid="tcg-card-image"
                className="h-auto w-full rounded-[4.5%/3.2%] shadow-2xl shadow-black/40"
              />
            </a>
          ) : (
            <div className="flex aspect-[245/342] items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">{t("card.noImage")}</div>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          <header className="hud space-y-3 rounded-lg border bg-card p-5">
            <p className="hud-label text-screen">{[card.supertype, ...(card.subtypes ?? [])].filter(Boolean).join(" · ") || t("card.card")}</p>
            <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl" data-testid="tcg-card-name">
              {card.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              {card.hp && <span className="font-display text-lg font-bold">HP {card.hp}</span>}
              {card.types?.map((ty) => <EnergyChip key={ty} type={ty} label={energy(ty)} />)}
              {card.evolvesFrom && <span className="text-sm text-muted-foreground">{t("card.evolvesFrom", { name: card.evolvesFrom })}</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {set && (
                <StatBox
                  label={t("card.set")}
                  value={
                    <Link href={`/pokedex/tcg/${set.id}`} className="flex items-center gap-1.5 text-base hover:text-screen">
                      {set.images?.symbol && <img src={set.images.symbol} alt="" className="h-4 w-4 object-contain" />}
                      {set.name}
                    </Link>
                  }
                />
              )}
              {card.number && <StatBox label={t("card.number")} value={set?.printedTotal ? `${card.number}/${set.printedTotal}` : card.number} />}
              {card.rarity && <StatBox label={t("card.rarity")} value={<span className="text-base">{card.rarity}</span>} />}
              {card.artist && <StatBox label={t("card.artist")} value={<span className="text-base">{card.artist}</span>} />}
              {card.regulationMark && <StatBox label={t("card.reg")} value={card.regulationMark} />}
            </div>
            {species.length > 0 && (
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {species.map((p) => (
                  <Link key={p.id} href={`/pokemon/${p.slug}`} className="text-screen underline-offset-2 hover:underline" data-testid="tcg-dex-link">
                    {t("card.entry", { dex: String(p.id).padStart(4, "0"), name: speciesName(p.id, p.name, locale) })}
                  </Link>
                ))}
              </p>
            )}
          </header>

          <section className="space-y-3" aria-labelledby="prices-title" data-testid="tcg-prices">
            <HudHeading id="prices-title" title={t("card.prices")} aside={tcgDate || cmDate ? t("card.pricesAsOf", { date: (tcgDate ?? cmDate)! }) : undefined} />
            {card.pricesUnavailable && <p className="text-sm text-muted-foreground" data-testid="tcg-price-note">{t("card.pricesUnavailable")}</p>}
            {!card.pricesUnavailable && tcg.length === 0 && cm.length === 0 && <p className="text-sm text-muted-foreground" data-testid="tcg-price-note">{t("card.noPrices")}</p>}
            {tcg.length > 0 && (
              <div className="hud rounded-lg border bg-card p-3">
                <div className="mb-2 break-words font-pixel text-[10px] uppercase tracking-wider text-muted-foreground" data-testid="tcg-price-source">
                  {tcgSource} · USD
                </div>
                {/* Wide screens: one row per printing. */}
                <table className="hidden w-full text-left text-sm sm:table">
                  <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2">{t("card.variant")}</th>
                      <th className="px-2 py-2 text-right">{t("card.market")}</th>
                      <th className="px-2 py-2 text-right">{t("card.low")}</th>
                      <th className="px-2 py-2 text-right">{t("card.mid")}</th>
                      <th className="px-2 py-2 text-right">{t("card.high")}</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {tcg.map((r) => (
                      <tr key={r.variant} className="border-t border-foreground/10">
                        <th scope="row" className="px-2 py-3 font-sans font-semibold">{variantName(r.variant, r.label, t)}</th>
                        <td className="px-2 py-3 text-right font-semibold text-screen">{cell(r.market, intl)}</td>
                        <td className="px-2 py-3 text-right">{cell(r.low, intl)}</td>
                        <td className="px-2 py-3 text-right">{cell(r.mid, intl)}</td>
                        <td className="px-2 py-3 text-right">{cell(r.high, intl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* Phones: labelled tiles per printing, like Cardmarket's, so nothing scrolls sideways. */}
                <div className="space-y-3 sm:hidden" data-testid="tcg-price-tiles">
                  {tcg.map((r) => (
                    <div key={r.variant}>
                      <div className="mb-1.5 text-sm font-semibold">{variantName(r.variant, r.label, t)}</div>
                      <dl className="grid grid-cols-2 gap-2">
                        {(
                          [
                            ["market", r.market],
                            ["low", r.low],
                            ["mid", r.mid],
                            ["high", r.high],
                            ["directLow", r.directLow],
                          ] as const
                        )
                          .filter(([label, v]) => v !== null || label !== "directLow")
                          .map(([label, v]) => (
                            <div key={t(`card.${label}`)} className="min-w-0 rounded-md border border-foreground/10 bg-shade/30 px-3 py-2">
                              <dt className="font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">{t(`card.${label}`)}</dt>
                              <dd className={`break-words font-mono text-base tabular-nums${label === "market" ? " font-semibold text-screen" : ""}`}>{cell(v, intl)}</dd>
                            </div>
                          ))}
                      </dl>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {cm.length > 0 && (
              <div className="hud rounded-lg border bg-card p-3">
                <div className="mb-2 break-words font-pixel text-[10px] uppercase tracking-wider text-muted-foreground" data-testid="tcg-price-source">
                  {cmSource} · EUR
                </div>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {cm.map((r) => (
                    <div key={r.key} className="min-w-0 rounded-md border border-foreground/10 bg-shade/30 px-3 py-2">
                      <dt className="font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">{cardmarketLabel(r.key, r.label, t)}</dt>
                      <dd className="font-mono text-base tabular-nums">{formatPrice(r.value, "EUR", intl)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {card.tcgplayer?.url && (
                <a href={card.tcgplayer.url} target="_blank" rel="noopener nofollow" className="inline-flex items-center gap-1.5 rounded-md border border-foreground/15 bg-card px-3 py-2 text-sm hover:border-screen/60">
                  TCGplayer <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {card.cardmarket?.url && (
                <a href={card.cardmarket.url} target="_blank" rel="noopener nofollow" className="inline-flex items-center gap-1.5 rounded-md border border-foreground/15 bg-card px-3 py-2 text-sm hover:border-screen/60">
                  {card.cardmarket.url.includes("/Products/Search?") ? t("card.findOnCardmarket") : "Cardmarket"} <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </section>

          {(card.abilities?.length || card.attacks?.length || card.rules?.length) && (
            <section className="space-y-3" aria-labelledby="text-title">
              <HudHeading id="text-title" title={card.attacks?.length || card.abilities?.length ? t("card.attacks") : t("card.cardText")} />
              <ul className="hud divide-y divide-foreground/10 rounded-lg border bg-card">
                {card.abilities?.map((a) => (
                  <li key={`ab-${a.name}`} className="space-y-1 p-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded-sm bg-primary px-1.5 py-0.5 font-pixel text-[9px] uppercase text-primary-foreground">{a.type ?? t("card.ability")}</span>
                      <span className="font-display font-bold uppercase tracking-wide">{a.name}</span>
                    </div>
                    {a.text && <p className="text-sm text-foreground/85">{a.text}</p>}
                  </li>
                ))}
                {card.attacks?.map((a, i) => (
                  <li key={`at-${i}`} className="space-y-1 p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex gap-0.5">{a.cost?.map((c, j) => <EnergyChip key={j} type={c} dot label={energy(c)} />)}</span>
                      <span className="flex-1 font-display font-bold uppercase tracking-wide">{a.name}</span>
                      {a.damage && <span className="font-display text-lg font-bold">{a.damage}</span>}
                    </div>
                    {a.text && <p className="text-sm text-foreground/85">{a.text}</p>}
                  </li>
                ))}
                {!card.attacks?.length && !card.abilities?.length &&
                  card.rules?.map((r, i) => (
                    <li key={`r-${i}`} className="p-3 text-sm text-foreground/85">
                      {r}
                    </li>
                  ))}
              </ul>
              {(card.weaknesses?.length || card.resistances?.length || card.retreatCost?.length) && (
                <div className="flex flex-wrap gap-2">
                  {card.weaknesses?.length ? <StatBox label={t("card.weakness")} value={<span className="flex items-center gap-1 text-base">{card.weaknesses.map((w) => <span key={w.type} className="flex items-center gap-1"><EnergyChip type={w.type} dot label={energy(w.type)} />{w.value}</span>)}</span>} /> : null}
                  {card.resistances?.length ? <StatBox label={t("card.resistance")} value={<span className="flex items-center gap-1 text-base">{card.resistances.map((w) => <span key={w.type} className="flex items-center gap-1"><EnergyChip type={w.type} dot label={energy(w.type)} />{w.value}</span>)}</span>} /> : null}
                  {card.retreatCost?.length ? <StatBox label={t("card.retreat")} value={<span className="flex gap-0.5">{card.retreatCost.map((c, j) => <EnergyChip key={j} type={c} dot label={energy(c)} />)}</span>} /> : null}
                </div>
              )}
            </section>
          )}
          {card.flavorText && <p className="border-l-2 border-screen/50 pl-3 text-sm italic text-muted-foreground">{card.flavorText}</p>}
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {t("card.footer")}
        {relays.map((s) => (
          <span key={s}>
            {" "}
            {t.rich(s === "tcgcsv" ? "card.tcgplayerCourtesy" : "card.cardmarketCourtesy", {
              source: PRICE_SOURCES[s].name,
              a: (c) => (
                <a href={PRICE_SOURCES[s].url} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-foreground">
                  {c}
                </a>
              ),
            })}
          </span>
        ))}{" "}
        {t("card.footerEnd")}
      </p>
    </article>
  );
}

