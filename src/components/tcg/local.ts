import "server-only";
import { INTL_LOCALE, type Translator } from "@/i18n/catalog";
import { getLocale, serverT } from "@/i18n/server";
import tcg from "@/messages/tcg";
import tcgCards from "@/messages/tcg-cards";
import { PRICE_SOURCES, formatApiDate, tcgplayerRows, toTile } from "@/lib/tcg/prices";
import type { CardTile, PriceSource, TcgCard } from "@/lib/tcg/types";

/**
 * The TCG pages' words for the card data's own labels (price variants, Cardmarket's fields, energy types) in the
 * page's language. Card text itself (names, attacks, abilities, rarities, set names) is the card source's English.
 * Server only: client components get the words ready-made, and only on pages in another language.
 */

type T = Translator<typeof tcg.en>;

/** The Intl locale of the render's language ("en-US" on English pages, as before). */
export const pageIntl = () => INTL_LOCALE[getLocale()];

/** A TCGplayer printing's name ("reverseHolofoil"): the page's language for the known ones, else the given label. */
export function variantName(key: string, label: string, t: T): string {
  const k = `variants.${key}`;
  return t.has(k) ? t(k as Parameters<T>[0]) : label;
}

/** A Cardmarket price field's label ("trendPrice" → "Trend"). */
export function cardmarketLabel(key: string, label: string, t: T): string {
  const k = `cardmarket.${key}`;
  return t.has(k) ? t(k as Parameters<T>[0]) : label;
}

/** An energy type or supertype ("Lightning", "Trainer") as the TCG prints it in the page's language. */
export function energyName(type: string, t: T): string {
  const k = `energy.${type}`;
  return t.has(k) ? t(k as Parameters<T>[0]) : type;
}

/** "TCGplayer via TCGCSV · as of Oct 26, 2026": lib/tcg/prices' priceSourceLine in the page's language. */
export function sourceLine(market: "TCGplayer" | "Cardmarket", source: PriceSource | undefined, updatedAt: string | undefined | null, t: T): string {
  const date = formatApiDate(updatedAt, pageIntl());
  return [source ? t("source.via", { market, source: PRICE_SOURCES[source].name }) : market, date && t("source.asOf", { date })].filter(Boolean).join(" · ");
}

/** A list's tiles, with each headline price's label in the page's language (English pages: toTile as it was). */
export function pageTiles(cards: TcgCard[]): CardTile[] {
  const tiles = cards.map(toTile);
  if (getLocale() === "en") return tiles;
  const t = serverT(tcg);
  const tc = serverT(tcgCards);
  return tiles.map((tile, i) => {
    if (!tile.price) return tile;
    let label = tile.price.label;
    if (tile.price.currency === "EUR") label = tc("note.cmTrend");
    else {
      const row = tcgplayerRows(cards[i]).find((r) => (r.market ?? r.mid) !== null);
      if (row) label = variantName(row.variant, row.label, t);
    }
    return { ...tile, price: { ...tile.price, label } };
  });
}

/** The energy types and supertypes of a set's tiles in the page's language, for its Type filter (none on English pages). */
export function kindNames(tiles: CardTile[]): Record<string, string> | undefined {
  if (getLocale() === "en") return undefined;
  const t = serverT(tcg);
  return Object.fromEntries([...new Set(tiles.flatMap((x) => x.kinds))].map((k) => [k, energyName(k, t)]));
}
