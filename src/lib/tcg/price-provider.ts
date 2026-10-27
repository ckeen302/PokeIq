import "server-only";
import type { TcgCard, TcgSet } from "./types";
import { cardmarketRows, tcgplayerRows } from "./prices";
import { matchCard, normName, normNumber } from "./price-match";
import { groupPrices, groupsForSet, priceSetEntry, type GroupPrices } from "./tcgcsv";
import { tcgdexCard } from "./tcgdex";

/**
 * Prices for cards, from the best source that has them:
 *
 * 1. The Pokémon TCG API's own `tcgplayer` / `cardmarket` blocks when it is up
 *    and has them (source "pokemontcg").
 * 2. Otherwise TCGplayer (USD) via TCGCSV: the set's TCGplayer group(s) from
 *    price-sets.json, the card matched by number and name (price-match.ts).
 * 3. On a card's own page, Cardmarket (EUR) via TCGdex when the API had none.
 *
 * Nothing is estimated: a card that can't be matched with confidence gets no
 * price. Every price keeps its source and date. Never mutates its input (the
 * fallback's cached card objects are shared between requests).
 */

const setIdOf = (cardId: string) => cardId.slice(0, Math.max(0, cardId.lastIndexOf("-"))) || cardId;

/** TCGplayer's product page; its /product/<id> URL redirects to the canonical slug. */
export const tcgplayerProductUrl = (productId: number) => `https://www.tcgplayer.com/product/${productId}`;
/**
 * Cardmarket pages are keyed by slugs TCGdex doesn't give us (only a numeric
 * idProduct), so the link is a Cardmarket search for the card instead.
 */
export const cardmarketSearchUrl = (name: string) => `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(name)}`;

function tagApiPrices(card: TcgCard): TcgCard {
  const tcg = tcgplayerRows(card).length > 0;
  const cm = cardmarketRows(card).length > 0;
  if (!tcg && !cm) return card;
  return { ...card, priceSources: { ...(tcg && { tcgplayer: "pokemontcg" as const }), ...(cm && { cardmarket: "pokemontcg" as const }) } };
}

interface SetPrices {
  groups: GroupPrices[];
  promo: boolean;
}

async function pricesForSet(set: TcgSet): Promise<SetPrices | null> {
  const ids = await groupsForSet(set);
  const groups = await Promise.all(ids.map(groupPrices));
  if (groups.some((g) => g === null)) return null; // TCGCSV unreachable: prices unknown, not absent
  return { groups: groups as GroupPrices[], promo: priceSetEntry(set.id)?.promo === true };
}

/** Attaches the card's TCGplayer product (link) and prices when it matches with confidence; otherwise it has no price. */
function applyTcgcsv(card: TcgCard, sp: SetPrices): TcgCard {
  // TCGCSV answered for this set, so the card's prices are known now (possibly: none).
  const known = { ...card };
  delete known.pricesUnavailable;
  const products = sp.groups.flatMap((g) => g.products);
  const m = matchCard({ name: card.name, number: card.number }, products, { promoSet: sp.promo });
  if (!m.productId) return known;
  const group = sp.groups.find((g) => g.products.some((p) => p.productId === m.productId))!;
  const prices = group.prices[m.productId];
  return {
    ...known,
    tcgplayer: { url: tcgplayerProductUrl(m.productId), ...(prices && { updatedAt: group.updatedAt ?? undefined, prices }) },
    priceSources: { ...known.priceSources, ...(prices && { tcgplayer: "tcgcsv" as const }) },
  };
}

/** The TCGplayer product id we matched the card to, if any. */
const matchedProductId = (card: TcgCard) => Number(card.tcgplayer?.url?.match(/^https:\/\/www\.tcgplayer\.com\/product\/(\d+)$/)?.[1]) || null;

async function applyTcgdex(card: TcgCard): Promise<TcgCard> {
  if (cardmarketRows(card).length || !card.number) return card;
  const dexSet = priceSetEntry(card.set?.id ?? setIdOf(card.id))?.tcgdex;
  if (!dexSet) return card;
  const dex = await tcgdexCard(dexSet, card.number);
  if (!dex?.cardmarket) return card;
  // Same card? TCGdex's own name and number must agree with ours…
  if (normName(dex.name).replace(/ delta$/, "") !== normName(card.name).replace(/ delta$/, "") || normNumber(dex.localId) !== normNumber(card.number)) return card;
  // …and when both of us link it to TCGplayer, to the same product (TCGdex's marketplace links are known to be wrong at times).
  const ours = matchedProductId(card);
  if (ours && dex.tcgplayerProductIds.length && !dex.tcgplayerProductIds.includes(ours)) return card;
  return {
    ...card,
    cardmarket: {
      url: cardmarketSearchUrl(card.name),
      ...(dex.cardmarket.updatedAt && { updatedAt: dex.cardmarket.updatedAt }),
      prices: dex.cardmarket.prices,
    },
    priceSources: { ...card.priceSources, cardmarket: "tcgdex" },
  };
}

export interface PriceOptions {
  /** Also look up Cardmarket via TCGdex (one request per card: card pages only). */
  cardmarket?: boolean;
  /**
   * Stop waiting for TCGCSV after this long (lists spanning many sets): cards of
   * sets that haven't loaded yet keep "prices unknown"; the loads carry on and
   * warm the cache for the next view.
   */
  budgetMs?: number;
}

export async function withPrices(cards: TcgCard[], opts: PriceOptions = {}): Promise<TcgCard[]> {
  const out = cards.map(tagApiPrices);
  const sets = new Map<string, TcgSet>();
  for (const c of out) {
    if (tcgplayerRows(c).length) continue;
    const set = c.set ?? { id: setIdOf(c.id), name: "", series: "" };
    if (!sets.has(set.id)) sets.set(set.id, set);
  }
  if (sets.size) {
    const loads = [...sets.values()].map((s) => pricesForSet(s).then((p) => [s.id, p] as const));
    const settled = new Map<string, SetPrices | null>();
    const all = Promise.all(loads.map((l) => l.then(([id, p]) => settled.set(id, p))));
    if (opts.budgetMs === undefined) await all;
    else await Promise.race([all, new Promise((r) => setTimeout(r, opts.budgetMs))]);
    for (let i = 0; i < out.length; i++) {
      const c = out[i];
      if (tcgplayerRows(c).length) continue;
      const sp = settled.get(c.set?.id ?? setIdOf(c.id));
      if (sp) out[i] = applyTcgcsv(c, sp);
    }
  }
  return opts.cardmarket ? Promise.all(out.map(applyTcgdex)) : out;
}

export async function withCardPrices(card: TcgCard): Promise<TcgCard> {
  return (await withPrices([card], { cardmarket: true }))[0];
}
