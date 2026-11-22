import { INTL_LOCALE, type Translator } from "@/i18n/catalog";
import tcgCards from "@/messages/tcg-cards";
import { PRICE_SOURCES, formatApiDate } from "@/lib/tcg/prices";
import type { CardTile } from "@/lib/tcg/types";

type T = Translator<typeof tcgCards.en>;

/**
 * lib/tcg/prices' tilePriceNote in the page's language (English pages keep using tilePriceNote itself): where a
 * list's prices came from and the latest date, or that prices are unknown right now. Empty when there's nothing to say.
 */
export function localPriceNote(tiles: CardTile[], t: T): string {
  const priced = tiles.flatMap((x) => (x.price ? [x.price] : []));
  const unknown = tiles.some((x) => x.pricesUnavailable && !x.price);
  if (!priced.length) return unknown ? t("note.unavailable") : "";
  const latest = new Map<string, string>();
  for (const p of priced) {
    const market = p.currency === "USD" ? t("note.usd") : t("note.eur");
    const key = p.source ? t("note.via", { market, source: PRICE_SOURCES[p.source].name }) : market;
    const prev = latest.get(key);
    if (prev === undefined || (p.asOf ?? "") > prev) latest.set(key, p.asOf ?? "");
  }
  const intl = INTL_LOCALE[t.locale];
  const parts = [...latest.entries()].map(([k, d]) => {
    const date = formatApiDate(d, intl);
    return date ? t("note.asOf", { what: k, date }) : k;
  });
  return t(unknown ? "note.lineSome" : "note.line", { parts: parts.join(t("note.sep")) });
}
