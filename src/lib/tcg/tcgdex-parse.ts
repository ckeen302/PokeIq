import { toApiDate } from "./tcgcsv-parse";

/** What PokéIQ reads from a TCGdex card response (api.tcgdex.net/v2/en/cards/…). */
export interface TcgdexCardPricing {
  name: string;
  localId: string;
  /** TCGdex says a reverse-holo printing exists (Cardmarket's "-holo" columns are then the reverse holo). */
  reverse: boolean;
  /** TCGplayer product ids TCGdex links this card to (used to sanity-check its Cardmarket link). */
  tcgplayerProductIds: number[];
  cardmarket: {
    idProduct: number | null;
    /** "YYYY/MM/DD" */
    updatedAt: string | null;
    /** In the Pokémon TCG API's Cardmarket field names, so prices.ts can show them as is. EUR. */
    prices: Record<string, number>;
  } | null;
}

/** TCGdex Cardmarket field → Pokémon TCG API Cardmarket field. */
const CARDMARKET_FIELDS: [string, string][] = [
  ["trend", "trendPrice"],
  ["avg", "averageSellPrice"],
  ["avg1", "avg1"],
  ["avg7", "avg7"],
  ["avg30", "avg30"],
  ["low", "lowPrice"],
];
/** Cardmarket's foil columns: for Pokémon these are the reverse holo, so only kept when one exists. */
const CARDMARKET_REVERSE_FIELDS: [string, string][] = [
  ["trend-holo", "reverseHoloTrend"],
  ["avg-holo", "reverseHoloSell"],
  ["avg30-holo", "reverseHoloAvg30"],
  ["low-holo", "reverseHoloLow"],
];

const pos = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

export function parseTcgdexCard(raw: unknown): TcgdexCardPricing | null {
  const c = raw as {
    name?: unknown;
    localId?: unknown;
    variants?: { reverse?: unknown };
    pricing?: { cardmarket?: Record<string, unknown> | null; tcgplayer?: Record<string, unknown> | null } | null;
  } | null;
  if (!c || typeof c.name !== "string" || typeof c.localId !== "string") return null;
  const reverse = c.variants?.reverse === true;
  const tp = c.pricing?.tcgplayer;
  const tcgplayerProductIds = tp
    ? [...new Set(Object.values(tp).flatMap((v) => (v && typeof v === "object" && typeof (v as { productId?: unknown }).productId === "number" ? [(v as { productId: number }).productId] : [])))]
    : [];
  const cm = c.pricing?.cardmarket;
  let cardmarket: TcgdexCardPricing["cardmarket"] = null;
  if (cm && typeof cm === "object" && (cm.unit === undefined || cm.unit === "EUR")) {
    const prices: Record<string, number> = {};
    for (const [from, to] of [...CARDMARKET_FIELDS, ...(reverse ? CARDMARKET_REVERSE_FIELDS : [])]) {
      const v = pos(cm[from]);
      if (v !== null) prices[to] = v;
    }
    if (Object.keys(prices).length) {
      cardmarket = {
        idProduct: typeof cm.idProduct === "number" ? cm.idProduct : null,
        updatedAt: typeof cm.updated === "string" ? toApiDate(cm.updated) : null,
        prices,
      };
    }
  }
  return { name: c.name, localId: c.localId, reverse, tcgplayerProductIds, cardmarket };
}
