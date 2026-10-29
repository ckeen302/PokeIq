/* eslint-disable @next/next/no-img-element -- card scans are hot-linked from the TCG API's image CDN */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { SHARE_IMAGES, jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { DetailNav, StatBox } from "@/components/pokedex/detail/DetailParts";
import { HudHeading } from "@/components/game/HudHeading";
import { EnergyChip } from "@/components/tcg/EnergyChip";
import { getCard } from "@/lib/tcg/api";
import { cardmarketRows, formatApiDate, formatPrice, headlinePrice, PRICE_SOURCES, priceSourceLine, tcgplayerRows } from "@/lib/tcg/prices";
import { getPokemon } from "@/lib/pokemon/pokedex";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ cardId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const card = await getCard((await params).cardId);
  if (!card) return { title: "Pokémon card" };
  const price = headlinePrice(card);
  const where = [card.set?.name, card.number && `#${card.number}`].filter(Boolean).join(" ");
  return pageMetadata({
    title: `${card.name}${where ? ` — ${where}` : ""} · Pokémon Card Price`,
    description: `${card.name} from the ${card.set?.name ?? "Pokémon TCG"} set${card.rarity ? ` (${card.rarity})` : ""}${card.artist ? `, illustrated by ${card.artist}` : ""}.${price ? ` Market price ${formatPrice(price.value, price.currency)}${formatApiDate(price.asOf) ? ` as of ${formatApiDate(price.asOf)}` : ""}.` : ""} TCGplayer and Cardmarket prices.`,
    path: `/pokedex/tcg/card/${card.id}`,
    socialTitle: `${card.name} · PokéIQ TCG`,
    image: card.images?.large
      ? { url: card.images.large, alt: `${card.name} card${card.set ? ` from ${card.set.name}` : ""}`, width: 734, height: 1024 }
      : SHARE_IMAGES.pokedex,
  });
}

const cell = (v: number | null) => (v === null ? <span className="text-muted-foreground">—</span> : formatPrice(v, "USD"));

export default async function CardPage({ params }: PageProps) {
  const card = await getCard((await params).cardId);
  if (!card) {
    // Unknown id vs. the API being down look the same here; a 404 is the honest answer for a bad id.
    notFound();
  }
  const set = card.set;
  const tcg = tcgplayerRows(card);
  const cm = cardmarketRows(card);
  const species = (card.nationalPokedexNumbers ?? []).flatMap((n) => getPokemon(n) ?? []);
  const tcgDate = formatApiDate(card.tcgplayer?.updatedAt);
  const cmDate = formatApiDate(card.cardmarket?.updatedAt);
  const price = headlinePrice(card);
  const tcgSource = priceSourceLine("TCGplayer", card.priceSources?.tcgplayer, card.tcgplayer?.updatedAt);
  const cmSource = priceSourceLine("Cardmarket", card.priceSources?.cardmarket, card.cardmarket?.updatedAt);
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
    { name: "Pokédex", path: "/pokedex" },
    { name: "Pokémon TCG", path: "/pokedex/tcg" },
    ...(set ? [{ name: set.name, path: `/pokedex/tcg/${set.id}` }] : []),
    { name: card.name, path: `/pokedex/tcg/card/${card.id}` },
  ]);

  return (
    <article className="mx-auto max-w-6xl space-y-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(crumbs) }} />
      {set ? <DetailNav tab={`tcg/${set.id}`} label={set.name} /> : <DetailNav tab="tcg" label="All sets" />}

      <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,22rem)_1fr] lg:grid-cols-[minmax(0,26rem)_1fr]">
        <div className="mx-auto w-full max-w-sm md:sticky md:top-24 md:max-w-none md:self-start">
          {card.images?.large || card.images?.small ? (
            <a href={card.images.large ?? card.images.small} target="_blank" rel="noopener" className="block">
              <img
                src={card.images.large ?? card.images.small}
                alt={`${card.name} card${set ? ` from ${set.name}` : ""}`}
                width={734}
                height={1024}
                data-testid="tcg-card-image"
                className="h-auto w-full rounded-[4.5%/3.2%] shadow-2xl shadow-black/40"
              />
            </a>
          ) : (
            <div className="flex aspect-[245/342] items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">No image</div>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          <header className="hud space-y-3 rounded-lg border bg-card p-5">
            <p className="hud-label text-screen">{[card.supertype, ...(card.subtypes ?? [])].filter(Boolean).join(" · ") || "Card"}</p>
            <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl" data-testid="tcg-card-name">
              {card.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              {card.hp && <span className="font-display text-lg font-bold">HP {card.hp}</span>}
              {card.types?.map((t) => <EnergyChip key={t} type={t} />)}
              {card.evolvesFrom && <span className="text-sm text-muted-foreground">Evolves from {card.evolvesFrom}</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {set && (
                <StatBox
                  label="Set"
                  value={
                    <Link href={`/pokedex/tcg/${set.id}`} className="flex items-center gap-1.5 text-base hover:text-screen">
                      {set.images?.symbol && <img src={set.images.symbol} alt="" className="h-4 w-4 object-contain" />}
                      {set.name}
                    </Link>
                  }
                />
              )}
              {card.number && <StatBox label="Number" value={set?.printedTotal ? `${card.number}/${set.printedTotal}` : card.number} />}
              {card.rarity && <StatBox label="Rarity" value={<span className="text-base">{card.rarity}</span>} />}
              {card.artist && <StatBox label="Artist" value={<span className="text-base">{card.artist}</span>} />}
              {card.regulationMark && <StatBox label="Reg." value={card.regulationMark} />}
            </div>
            {species.length > 0 && (
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {species.map((p) => (
                  <Link key={p.id} href={`/pokemon/${p.slug}`} className="text-screen underline-offset-2 hover:underline" data-testid="tcg-dex-link">
                    #{String(p.id).padStart(4, "0")} {p.name} — Pokédex entry →
                  </Link>
                ))}
              </p>
            )}
          </header>

          <section className="space-y-3" aria-labelledby="prices-title" data-testid="tcg-prices">
            <HudHeading id="prices-title" title="Prices" aside={tcgDate || cmDate ? `prices as of ${tcgDate ?? cmDate}` : undefined} />
            {card.pricesUnavailable && <p className="text-sm text-muted-foreground" data-testid="tcg-price-note">Prices unavailable right now.</p>}
            {!card.pricesUnavailable && tcg.length === 0 && cm.length === 0 && <p className="text-sm text-muted-foreground" data-testid="tcg-price-note">No market prices are listed for this card.</p>}
            {tcg.length > 0 && (
              <div className="hud rounded-lg border bg-card p-3">
                <div className="mb-2 break-words font-pixel text-[10px] uppercase tracking-wider text-muted-foreground" data-testid="tcg-price-source">
                  {tcgSource} · USD
                </div>
                {/* Wide screens: one row per printing. */}
                <table className="hidden w-full text-left text-sm sm:table">
                  <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2">Variant</th>
                      <th className="px-2 py-2 text-right">Market</th>
                      <th className="px-2 py-2 text-right">Low</th>
                      <th className="px-2 py-2 text-right">Mid</th>
                      <th className="px-2 py-2 text-right">High</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {tcg.map((r) => (
                      <tr key={r.variant} className="border-t border-foreground/10">
                        <th scope="row" className="px-2 py-3 font-sans font-semibold">{r.label}</th>
                        <td className="px-2 py-3 text-right font-semibold text-screen">{cell(r.market)}</td>
                        <td className="px-2 py-3 text-right">{cell(r.low)}</td>
                        <td className="px-2 py-3 text-right">{cell(r.mid)}</td>
                        <td className="px-2 py-3 text-right">{cell(r.high)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* Phones: labelled tiles per printing, like Cardmarket's, so nothing scrolls sideways. */}
                <div className="space-y-3 sm:hidden" data-testid="tcg-price-tiles">
                  {tcg.map((r) => (
                    <div key={r.variant}>
                      <div className="mb-1.5 text-sm font-semibold">{r.label}</div>
                      <dl className="grid grid-cols-2 gap-2">
                        {(
                          [
                            ["Market", r.market],
                            ["Low", r.low],
                            ["Mid", r.mid],
                            ["High", r.high],
                            ["Direct low", r.directLow],
                          ] as const
                        )
                          .filter(([label, v]) => v !== null || label !== "Direct low")
                          .map(([label, v]) => (
                            <div key={label} className="min-w-0 rounded-md border border-foreground/10 bg-shade/30 px-3 py-2">
                              <dt className="font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">{label}</dt>
                              <dd className={`break-words font-mono text-base tabular-nums${label === "Market" ? " font-semibold text-screen" : ""}`}>{cell(v)}</dd>
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
                      <dt className="font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">{r.label}</dt>
                      <dd className="font-mono text-base tabular-nums">{formatPrice(r.value, "EUR")}</dd>
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
                  {card.cardmarket.url.includes("/Products/Search?") ? "Find on Cardmarket" : "Cardmarket"} <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </section>

          {(card.abilities?.length || card.attacks?.length || card.rules?.length) && (
            <section className="space-y-3" aria-labelledby="text-title">
              <HudHeading id="text-title" title={card.attacks?.length || card.abilities?.length ? "Attacks" : "Card text"} />
              <ul className="hud divide-y divide-foreground/10 rounded-lg border bg-card">
                {card.abilities?.map((a) => (
                  <li key={`ab-${a.name}`} className="space-y-1 p-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded-sm bg-primary px-1.5 py-0.5 font-pixel text-[9px] uppercase text-primary-foreground">{a.type ?? "Ability"}</span>
                      <span className="font-display font-bold uppercase tracking-wide">{a.name}</span>
                    </div>
                    {a.text && <p className="text-sm text-foreground/85">{a.text}</p>}
                  </li>
                ))}
                {card.attacks?.map((a, i) => (
                  <li key={`at-${i}`} className="space-y-1 p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex gap-0.5">{a.cost?.map((c, j) => <EnergyChip key={j} type={c} dot />)}</span>
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
                  {card.weaknesses?.length ? <StatBox label="Weakness" value={<span className="flex items-center gap-1 text-base">{card.weaknesses.map((w) => <span key={w.type} className="flex items-center gap-1"><EnergyChip type={w.type} dot />{w.value}</span>)}</span>} /> : null}
                  {card.resistances?.length ? <StatBox label="Resistance" value={<span className="flex items-center gap-1 text-base">{card.resistances.map((w) => <span key={w.type} className="flex items-center gap-1"><EnergyChip type={w.type} dot />{w.value}</span>)}</span>} /> : null}
                  {card.retreatCost?.length ? <StatBox label="Retreat" value={<span className="flex gap-0.5">{card.retreatCost.map((c, j) => <EnergyChip key={j} type={c} dot />)}</span>} /> : null}
                </div>
              )}
            </section>
          )}
          {card.flavorText && <p className="border-l-2 border-screen/50 pl-3 text-sm italic text-muted-foreground">{card.flavorText}</p>}
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Card data and image from the Pokémon TCG API.
        {relays.map((s) => (
          <span key={s}>
            {" "}
            {s === "tcgcsv" ? "TCGplayer prices" : "Cardmarket prices"} courtesy of{" "}
            <a href={PRICE_SOURCES[s].url} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-foreground">
              {PRICE_SOURCES[s].name}
            </a>
            .
          </span>
        ))}{" "}
        Prices change daily; check the marketplace before buying.
      </p>
    </article>
  );
}

