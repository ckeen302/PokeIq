import type { CardTile, PriceSource, TcgCard, TcgSet } from "./types";

/** TCGplayer's variant keys, in the order a collector reads them. */
const TCGPLAYER_VARIANTS: Record<string, string> = {
  normal: "Normal",
  holofoil: "Holofoil",
  reverseHolofoil: "Reverse Holofoil",
  "1stEdition": "1st Edition",
  "1stEditionNormal": "1st Edition",
  "1stEditionHolofoil": "1st Edition Holofoil",
  unlimited: "Unlimited",
  unlimitedHolofoil: "Unlimited Holofoil",
};

/** "reverseHolofoil" → "Reverse Holofoil"; unknown keys are split on their capitals. */
export function variantLabel(key: string): string {
  return TCGPLAYER_VARIANTS[key] ?? key.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface TcgplayerRow {
  variant: string;
  label: string;
  market: number | null;
  low: number | null;
  mid: number | null;
  high: number | null;
}

/** TCGplayer prices per variant (USD), known variants first; rows with no price at all are left out. */
export function tcgplayerRows(card: TcgCard): TcgplayerRow[] {
  const prices = card.tcgplayer?.prices ?? {};
  const order = Object.keys(TCGPLAYER_VARIANTS);
  return Object.entries(prices)
    .flatMap(([variant, p]) => {
      if (!p) return [];
      const row = { variant, label: variantLabel(variant), market: num(p.market), low: num(p.low), mid: num(p.mid), high: num(p.high) };
      return row.market === null && row.low === null && row.mid === null && row.high === null ? [] : [row];
    })
    .sort((a, b) => (order.indexOf(a.variant) + 1 || 99) - (order.indexOf(b.variant) + 1 || 99));
}

/** Cardmarket's price fields we show (EUR). Cardmarket writes 0 for "no data", so 0 is treated as missing. */
const CARDMARKET_FIELDS: [string, string][] = [
  ["trendPrice", "Trend"],
  ["averageSellPrice", "Average sell"],
  ["avg1", "1-day avg"],
  ["avg7", "7-day avg"],
  ["avg30", "30-day avg"],
  ["lowPrice", "Low"],
  ["reverseHoloTrend", "Reverse Holo trend"],
  ["reverseHoloSell", "Reverse Holo avg sell"],
  ["reverseHoloAvg30", "Reverse Holo 30-day avg"],
  ["reverseHoloLow", "Reverse Holo low"],
];

export function cardmarketRows(card: TcgCard): { key: string; label: string; value: number }[] {
  const prices = card.cardmarket?.prices ?? {};
  return CARDMARKET_FIELDS.flatMap(([key, label]) => {
    const v = num(prices[key]);
    return v !== null && v > 0 ? [{ key, label, value: v }] : [];
  });
}

/**
 * One headline price for a list: TCGplayer market (else mid) of the first
 * variant that has one, else Cardmarket's trend in EUR. Null when neither exists.
 * Carries its source and "as of" date (API format) when known.
 */
export function headlinePrice(card: TcgCard): CardTile["price"] {
  for (const r of tcgplayerRows(card)) {
    const v = r.market ?? r.mid;
    if (v !== null) return withProvenance({ value: v, currency: "USD", label: r.label }, card.priceSources?.tcgplayer, card.tcgplayer?.updatedAt);
  }
  const trend = num(card.cardmarket?.prices?.trendPrice) ?? num(card.cardmarket?.prices?.averageSellPrice);
  return trend !== null && trend > 0 ? withProvenance({ value: trend, currency: "EUR", label: "Cardmarket trend" }, card.priceSources?.cardmarket, card.cardmarket?.updatedAt) : null;
}

function withProvenance(p: NonNullable<CardTile["price"]>, source: PriceSource | undefined, updatedAt: string | undefined): CardTile["price"] {
  return { ...p, ...(source && { source }), ...(updatedAt && { asOf: updatedAt.slice(0, 10) }) };
}

/** Who relayed a price to us, for the source line under every price block. */
export const PRICE_SOURCES: Record<PriceSource, { name: string; url: string }> = {
  pokemontcg: { name: "Pokémon TCG API", url: "https://pokemontcg.io" },
  tcgcsv: { name: "TCGCSV", url: "https://tcgcsv.com" },
  tcgdex: { name: "TCGdex", url: "https://tcgdex.dev" },
};

/** "TCGplayer via TCGCSV · as of Oct 26, 2026": the market, who relayed it, and when. */
export function priceSourceLine(market: "TCGplayer" | "Cardmarket", source: PriceSource | undefined, updatedAt: string | undefined | null): string {
  const date = formatApiDate(updatedAt);
  return [`${market}${source ? ` via ${PRICE_SOURCES[source].name}` : ""}`, date && `as of ${date}`].filter(Boolean).join(" · ");
}

/**
 * The note under a list of tiles: where its prices came from and the latest
 * date, or that prices are unknown right now. Empty when there's nothing to say.
 */
export function tilePriceNote(tiles: CardTile[]): string {
  const priced = tiles.flatMap((t) => (t.price ? [t.price] : []));
  const unknown = tiles.some((t) => t.pricesUnavailable && !t.price);
  if (!priced.length) return unknown ? "Prices unavailable right now." : "";
  const latest = new Map<string, string>();
  for (const p of priced) {
    const market = p.currency === "USD" ? "TCGplayer market (USD)" : "Cardmarket trend (EUR)";
    const key = `${market}${p.source ? ` via ${PRICE_SOURCES[p.source].name}` : ""}`;
    const prev = latest.get(key);
    if (prev === undefined || (p.asOf ?? "") > prev) latest.set(key, p.asOf ?? "");
  }
  const parts = [...latest.entries()].map(([k, d]) => (formatApiDate(d) ? `${k}, as of ${formatApiDate(d)}` : k));
  return `Prices: ${parts.join("; ")}.${unknown ? " Some prices are unavailable right now." : ""}`;
}

export function formatPrice(value: number, currency: "USD" | "EUR"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

/** The API's "YYYY/MM/DD" (sometimes with a time) → "Oct 15, 2026". Null for anything unreadable. */
export function formatApiDate(raw: string | undefined | null): string | null {
  const m = raw?.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Rarity order for sorting, commonest first; unknown rarities sort after the known ones. */
export const RARITY_ORDER = [
  "Common",
  "Uncommon",
  "Rare",
  "Rare Holo",
  "Promo",
  "Classic Collection",
  "Rare Holo EX",
  "Rare Holo GX",
  "Rare Holo V",
  "Rare Holo VMAX",
  "Rare Holo VSTAR",
  "Double Rare",
  "Rare Ultra",
  "Ultra Rare",
  "Rare Shiny",
  "Shiny Rare",
  "ACE SPEC Rare",
  "Rare ACE",
  "Illustration Rare",
  "Rare Holo Star",
  "Rare Shiny GX",
  "Shiny Ultra Rare",
  "Rare Rainbow",
  "Rare Secret",
  "Special Illustration Rare",
  "Hyper Rare",
  "Mega Hyper Rare",
];

export function rarityRank(r: string | null): number {
  if (!r) return -1;
  const i = RARITY_ORDER.indexOf(r);
  return i === -1 ? RARITY_ORDER.length : i;
}

/** Collector numbers mix digits and letters ("15", "TG01", "SV107"): compare them naturally. */
export function compareNumber(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

export type TileSort = "number" | "price-desc" | "price-asc" | "rarity";

/** Price in USD sorts by value; EUR-only cards follow; unpriced cards come last either way. */
export function sortTiles(tiles: CardTile[], sort: TileSort): CardTile[] {
  const priceKey = (t: CardTile) => (t.price ? (t.price.currency === "USD" ? 0 : 1) : 2);
  return [...tiles].sort((a, b) => {
    if (sort === "rarity") return rarityRank(b.rarity) - rarityRank(a.rarity) || compareNumber(a.number, b.number);
    if (sort === "price-desc" || sort === "price-asc") {
      const k = priceKey(a) - priceKey(b);
      if (k) return k;
      if (a.price && b.price) {
        const d = sort === "price-desc" ? b.price.value - a.price.value : a.price.value - b.price.value;
        if (d) return d;
      }
    }
    return compareNumber(a.number, b.number);
  });
}

export function toTile(card: TcgCard): CardTile {
  return {
    id: card.id,
    name: card.name,
    number: card.number ?? "",
    rarity: card.rarity ?? null,
    kinds: card.types?.length ? card.types : card.supertype && card.supertype !== "Pokémon" ? [card.supertype] : [],
    image: card.images?.small ?? null,
    setName: card.set?.name ?? null,
    releaseDate: card.set?.releaseDate ?? null,
    price: headlinePrice(card),
    ...(card.pricesUnavailable && { pricesUnavailable: true }),
  };
}

/** Sets grouped by series (era), newest series first, newest set first within each. */
export function groupSetsBySeries(sets: TcgSet[]): { series: string; sets: TcgSet[] }[] {
  const sorted = [...sets].sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "") || a.name.localeCompare(b.name));
  const groups = new Map<string, TcgSet[]>();
  for (const s of sorted) {
    const key = s.series || "Other";
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.entries()].map(([series, list]) => ({ series, sets: list }));
}

/** Energy-type colours for chips (TCG types differ from the games': Lightning, Darkness, Metal, Colorless). */
export const ENERGY_COLORS: Record<string, string> = {
  Grass: "#7ac74c",
  Fire: "#ee8130",
  Water: "#6390f0",
  Lightning: "#f7d02c",
  Psychic: "#a95dc4",
  Fighting: "#c0602d",
  Darkness: "#3f4a54",
  Metal: "#9aa5b1",
  Fairy: "#d685ad",
  Dragon: "#b39433",
  Colorless: "#c8c4bc",
  Trainer: "#5b7fa6",
  Energy: "#8b7d6b",
};

export function energyTextColor(t: string): string {
  return ["Lightning", "Colorless", "Grass", "Metal"].includes(t) ? "#111827" : "#ffffff";
}
