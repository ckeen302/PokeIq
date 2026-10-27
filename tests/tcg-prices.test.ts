import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import matchFixture from "./fixtures/tcg-price-match.json";
import priceFixture from "@/lib/tcg/price-fixture.json";
import priceSets from "@/lib/tcg/price-sets.json";
import fallbackIndex from "@/lib/tcg/fallback-index.json";
import apiFixture from "@/lib/tcg/fixture.json";
import { guessGroup, matchCard, normName, normNumber, parseProductName, variantKey, type TcgcsvProduct } from "@/lib/tcg/price-match";
import { parseTcgcsvPrices, parseTcgcsvProducts, toApiDate } from "@/lib/tcg/tcgcsv-parse";
import { parseTcgdexCard } from "@/lib/tcg/tcgdex-parse";
import { withCardPrices, withPrices } from "@/lib/tcg/price-provider";
import { resetTcgcsvMemo } from "@/lib/tcg/tcgcsv";
import { headlinePrice, priceSourceLine, tcgplayerRows, tilePriceNote, toTile } from "@/lib/tcg/prices";
import type { TcgCard } from "@/lib/tcg/types";

/**
 * Card → TCGplayer product, checked by hand against TCGplayer's listings
 * (and, where it has one, TCGdex's own product id for the card). null = the
 * card must stay unmatched: no listing, or only stamped/variant listings, or
 * two equally good ones.
 */
const EXPECTED: Record<string, number | null> = {
  // Base / WotC
  "base1-4": 42382, // Charizard, unlimited Base Set group
  "base1-58": 42402,
  "base1-8": null, // Machamp: 1st Edition deck-only print, not in the unlimited group
  "base2-1": 45120, // "Clefable (1)": a number tag in brackets
  "base5-75": 84815, // "Digger (Rocket's Secret Machine)": the only listing, a subtitle note
  "basep-4": 88066, // "Pikachu (Movie Promo)"
  "gym1-2": 83978,
  "neo1-9": 86903,
  "neo2-14": 90196, // "Unown [A] (14)" vs "Unown [A] (33)"
  "ecard2-H1": 83537, // Aquapolis holo "H01/H32"
  "ecard2-50": null, // TCGplayer has 50a and 50b only
  // EX
  "ex13-1": 83622, // "Armaldo δ" = "Armaldo (Delta Species)"
  "ex10-S": 90186, // Unown "S" numbering
  "pop1-17": null, // holo and non-holo listings, no way to tell which
  "tk2a-9": 88339, // "Potion (Plusle)" in the shared trainer-kit group
  "tk1a-8": null, // "Potion (Latias)" and "(Latios)" share number 8
  // DP / Platinum / HGSS
  "dp1-65": 90198,
  "dp1-121": 86281, // LV.X
  "dpp-DP01": 90075, // promo "DP01"
  "pl1-1": 83543,
  "hgss1-111": 86133, // LEGEND top half
  "hgss1-112": 86132, // LEGEND bottom half
  "col1-1": 84348,
  // BW / XY
  "bw11-RC1": 89382, // Radiant Collection: second group
  "bwp-BW40": 90403, // prerelease promo is the card in a promo set
  "bw3-92": 87675, // "N (Supporter)"
  "xy1-141": 90325, // "Venusaur EX (141 Full Art)"
  "xy2-13": 91146, // "M Charizard EX (Y)"
  "xy2-88a": null, // alternate print TCGplayer doesn't list
  "xy4-92": 94661, // "… Team Flare Gear" suffix
  "xy7-96": 101518, // "(Shiny Full Art)"
  "g1-RC25": 113768, // Generations Radiant Collection
  // SM
  "sm5-58": 157675, // "Giratina ◇" = "Giratina Prism Star"
  "sm8-174": null, // "Fairy Charm Grass" vs "Fairy Charm G": not guessed
  "sma-SV49": 197780, // Hidden Fates Shiny Vault
  "smp-SM10": 127181, // prerelease promo; the [Staff] one is not it
  "sm115-1": 197643,
  // SWSH
  "swsh1-178": 208508, // "Professor's Research [Professor Magnolia]"
  "swsh9tg-TG01": 264210, // Trainer Gallery "TG01/TG30"
  "swsh12pt5gg-GG01": 478017, // Galarian Gallery "GG01/GG70"
  "swsh45sv-SV001": 232343, // Shining Fates Shiny Vault "SV001"
  "cel25-1": 250300,
  "cel25c-4_A": 250320, // Classic Collection uses the original "4/102"
  "cel25c-15_A1": 250321, // four cards numbered 15: name decides
  "swshp-SWSH001": 200300,
  // SV / ME
  "sv1-189": 475423, // "Professor's Research [Professor Sada] - 189/198"
  "sv2-172": 497544, // "Boss's Orders (Ghetsis)" vs "Boss's Orders - 172/193"
  "sv3-60": 509812, // "Finizen 60/197": bare trailing number
  "sv3pt5-6": 502558, // 151
  "sv3pt5-199": 517045, // 151 special illustration rare
  "svp-1": 477184,
  "sv8pt5-1": 610356, // ball-pattern variants are separate products
  "sve-1": 475425,
  "me1-1": 654340,
  "me2pt5-3": 675815,
  "me55-150": 712954,
  "me55c-58": 716194, // 30th Celebration Classic Collection
};

const fx = matchFixture as unknown as {
  sets: Record<string, { tcgplayer: number[]; promo?: true }>;
  cards: { id: string; name: string; number: string }[];
  products: Record<string, unknown[]>;
};
const setOf = (id: string) => id.slice(0, id.lastIndexOf("-"));
function productsFor(setId: string): TcgcsvProduct[] {
  return fx.sets[setId].tcgplayer.flatMap((g) => parseTcgcsvProducts({ results: fx.products[g] ?? [] }));
}

describe("card → TCGplayer product mapping", () => {
  it("covers every era and the tricky sets", () => {
    expect(fx.cards).toHaveLength(Object.keys(EXPECTED).length);
    expect(fx.cards.length).toBeGreaterThanOrEqual(40);
  });

  for (const card of fx.cards) {
    it(`${card.id} "${card.name}" #${card.number} → ${EXPECTED[card.id] ?? "no match"}`, () => {
      const setId = setOf(card.id);
      const r = matchCard(card, productsFor(setId), { promoSet: fx.sets[setId].promo === true });
      expect(r.productId).toBe(EXPECTED[card.id]);
    });
  }

  it("normalises collector numbers", () => {
    expect(normNumber("004/102")).toBe("4");
    expect(normNumber("4")).toBe("4");
    expect(normNumber("TG07/TG30")).toBe(normNumber("TG07"));
    expect(normNumber("TG07")).toBe("TG7");
    expect(normNumber("SV001")).toBe(normNumber("SV1"));
    expect(normNumber("GG01/GG70")).toBe("GG1");
    expect(normNumber("swsh020")).toBe("SWSH20");
    expect(normNumber("050a/147")).toBe("50A");
    expect(normNumber("50")).not.toBe(normNumber("50a"));
    expect(normNumber("RC25/RC32")).toBe("RC25");
    expect(normNumber(undefined)).toBe("");
  });

  it("normalises names", () => {
    expect(normName("Lycanroc-GX")).toBe(normName("Lycanroc GX"));
    expect(normName("Pokémon Fan Club")).toBe("pokemon fan club");
    expect(normName("Umbreon ★")).toBe(normName("Umbreon Star"));
    expect(normName("Giratina ◇")).toBe(normName("Giratina Prism Star"));
    expect(normName("Nidoran ♀")).toBe(normName("Nidoran F"));
    expect(normName("δ Rainbow Energy")).toBe(normName("Delta Rainbow Energy"));
    expect(normName("Farfetch’d")).toBe(normName("Farfetch'd"));
  });

  it("splits TCGplayer product names into name, variant notes and other notes", () => {
    expect(parseProductName("Pikachu - 173/165")).toMatchObject({ base: "Pikachu", variants: [], context: [] });
    expect(parseProductName("Tinkaton - 020 (Prerelease) [Staff]")).toMatchObject({ base: "Tinkaton", variants: ["Prerelease", "Staff"] });
    expect(parseProductName("Venusaur EX (141 Full Art)")).toMatchObject({ base: "Venusaur EX", variants: [], context: [] });
    expect(parseProductName("Porygon2 - 138 (Cosmos Holo)").variants).toEqual(["Cosmos Holo"]);
    expect(parseProductName("Exeggcute (Poke Ball Pattern)").variants).toEqual(["Poke Ball Pattern"]);
    expect(parseProductName("Digger (Rocket's Secret Machine)")).toMatchObject({ base: "Digger", variants: [], context: ["Rocket's Secret Machine"] });
    expect(parseProductName("Finizen 60/197", "060/197").base).toBe("Finizen");
    expect(parseProductName("Porygon2", "028/147").base).toBe("Porygon2");
  });

  it("never takes a stamped or variant printing for the card", () => {
    const products: TcgcsvProduct[] = [
      { productId: 1, name: "Pikachu - 001 (Prerelease)", number: "001", rarity: "Promo" },
      { productId: 2, name: "Pikachu - 001 (Cosmos Holo)", number: "001", rarity: "Promo" },
    ];
    expect(matchCard({ name: "Pikachu", number: "1" }, products)).toEqual({ productId: null, why: "only-variants" });
    // …but a plain listing next to them wins.
    expect(matchCard({ name: "Pikachu", number: "1" }, [...products, { productId: 3, name: "Pikachu - 001", number: "001", rarity: "Promo" }]).productId).toBe(3);
  });

  it("leaves a card unmatched when the name differs or nothing has its number", () => {
    const products: TcgcsvProduct[] = [{ productId: 9, name: "Raichu", number: "14/102", rarity: "Holo Rare" }];
    expect(matchCard({ name: "Pikachu", number: "14" }, products).productId).toBeNull();
    expect(matchCard({ name: "Raichu", number: "15" }, products).productId).toBeNull();
    expect(matchCard({ name: "Raichu" }, products).productId).toBeNull();
  });

  it("maps TCGplayer printings to our variant keys", () => {
    expect(variantKey("Normal")).toBe("normal");
    expect(variantKey("Reverse Holofoil")).toBe("reverseHolofoil");
    expect(variantKey("1st Edition Holofoil")).toBe("1stEditionHolofoil");
    expect(variantKey("Unlimited Holofoil")).toBe("unlimitedHolofoil");
    expect(variantKey("Some New Foil")).toBe("someNewFoil");
  });
});

describe("set → TCGplayer group table (price-sets.json)", () => {
  const table = (priceSets as unknown as { sets: Record<string, { tcgplayer: number[]; tcgdex: string | null; promo?: true }> }).sets;
  const groupIds = new Set((priceFixture as unknown as { groupList: { groupId: number }[] }).groupList.map((g) => g.groupId));

  it("has an entry for every set we can show", () => {
    const ours = new Set((fallbackIndex as unknown as { cards: [string][] }).cards.map((r) => setOf(r[0])));
    for (const s of (apiFixture as unknown as { sets: { id: string }[] }).sets) ours.add(s.id);
    const missing = [...ours].filter((s) => !table[s]);
    expect(missing).toEqual([]);
    const withGroup = [...ours].filter((s) => table[s].tcgplayer.length > 0);
    expect(withGroup.length / ours.size).toBeGreaterThan(0.99);
  });

  it("points only at real TCGplayer groups, one set per group (trainer-kit halves aside)", () => {
    const owners = new Map<number, string[]>();
    for (const [set, e] of Object.entries(table)) {
      for (const g of e.tcgplayer) {
        expect(groupIds.has(g), `${set} → ${g}`).toBe(true);
        owners.set(g, [...(owners.get(g) ?? []), set]);
      }
    }
    const shared = [...owners.values()].filter((s) => s.length > 1).map((s) => s.sort().join("+"));
    expect(shared.sort()).toEqual(["tk1a+tk1b", "tk2a+tk2b"]);
  });

  it("gets the tricky sets right", () => {
    expect(table.base1.tcgplayer).toEqual([604]); // not Shadowless (1663)
    expect(table.sv3pt5).toMatchObject({ tcgplayer: [23237], tcgdex: "sv03.5" }); // "SV: Scarlet & Violet 151"
    expect(table.cel25c.tcgplayer).toEqual([2931]); // Celebrations: Classic Collection
    expect(table.cel25.tcgplayer).toEqual([2867]);
    expect(table.me55c.tcgplayer).toEqual([24837]); // 30th Celebration Classic Collection
    expect(table.swsh9tg.tcgplayer).toEqual([3020]); // Trainer Gallery
    expect(table.swsh12pt5gg.tcgplayer).toEqual([17689]); // Galarian Gallery
    expect(table.sma.tcgplayer).toEqual([2594]); // Hidden Fates Shiny Vault
    expect(table.swsh45sv.tcgplayer).toEqual([2781]); // Shining Fates Shiny Vault
    expect(table.g1.tcgplayer).toEqual([1728, 1729]); // + Radiant Collection
    expect(table.bw11.tcgplayer).toEqual([1409, 1465]);
    expect(table.svp).toMatchObject({ tcgplayer: [22872], promo: true });
    expect(table.sv1.promo).toBeUndefined();
  });

  it("guesses a group for a set newer than the table only when one clearly fits", () => {
    const groups = [
      { groupId: 1, name: "ME06: Delta Reign", abbreviation: "DLR", publishedOn: "2026-11-06T00:00:00" },
      { groupId: 2, name: "ME: Ascended Heroes", abbreviation: "ASC", publishedOn: "2026-01-30T00:00:00" },
      { groupId: 3, name: "Some Promo Box", abbreviation: "DLR", publishedOn: "2020-01-01T00:00:00" },
    ];
    expect(guessGroup({ id: "me6", name: "Delta Reign", releaseDate: "2026/11/06" }, groups)).toBe(1);
    expect(guessGroup({ id: "x", name: "Something Else", ptcgoCode: "DLR", releaseDate: "2026/11/07" }, groups)).toBe(1);
    expect(guessGroup({ id: "x", name: "Ascended Heroes", releaseDate: "2024/01/30" }, groups)).toBeNull(); // name fits, date doesn't
    expect(guessGroup({ id: "x", name: "Nothing Like It", releaseDate: "2026/11/06" }, groups)).toBeNull();
  });
});

describe("TCGCSV and TCGdex parsers", () => {
  const groups = (priceFixture as unknown as { groups: Record<string, { products: unknown; prices: unknown; updatedAt: string }> }).groups;

  it("reads products: single cards only, with number and rarity", () => {
    const products = parseTcgcsvProducts(groups["604"].products);
    expect(products.find((p) => p.productId === 42382)).toEqual({ productId: 42382, name: "Charizard", number: "004/102", rarity: "Holo Rare" });
    expect(products.every((p) => p.number)).toBe(true);
    const raw = {
      results: [
        { productId: 1, name: "Booster Box", extendedData: [] },
        { productId: 2, name: "Card", extendedData: [{ name: "Number", value: "001/010" }] },
        { productId: "3", name: "Bad id", extendedData: [{ name: "Number", value: "2" }] },
        null,
      ],
    };
    expect(parseTcgcsvProducts(raw)).toEqual([{ productId: 2, name: "Card", number: "001/010", rarity: null }]);
    expect(parseTcgcsvProducts(null)).toEqual([]);
    expect(parseTcgcsvProducts({ success: false, results: "nope" })).toEqual([]);
  });

  it("reads prices per printing (USD), dropping empty and malformed rows", () => {
    const prices = parseTcgcsvPrices(groups["604"].prices);
    expect(prices[42382].holofoil.market).toBeGreaterThan(0);
    const raw = {
      results: [
        { productId: 5, lowPrice: 0.1, midPrice: 0.5, highPrice: 9, marketPrice: 0.4, directLowPrice: null, subTypeName: "Normal" },
        { productId: 5, lowPrice: 1, midPrice: null, highPrice: null, marketPrice: 2, directLowPrice: 1.5, subTypeName: "Reverse Holofoil" },
        { productId: 6, lowPrice: null, midPrice: null, highPrice: null, marketPrice: null, directLowPrice: null, subTypeName: "Holofoil" },
        { productId: 7, lowPrice: "1", marketPrice: -3, subTypeName: "Holofoil" },
        { productId: 8, marketPrice: 3 },
      ],
    };
    expect(parseTcgcsvPrices(raw)).toEqual({
      5: { normal: { low: 0.1, mid: 0.5, high: 9, market: 0.4, directLow: null }, reverseHolofoil: { low: 1, mid: null, high: null, market: 2, directLow: 1.5 } },
    });
  });

  it("turns HTTP dates into the API date format", () => {
    expect(toApiDate("Mon, 26 Oct 2026 20:00:07 GMT")).toBe("2026/10/26");
    expect(toApiDate("2026-10-26T20:05:56+0000")).toBe("2026/10/26");
    expect(toApiDate("garbage")).toBeNull();
    expect(toApiDate(null)).toBeNull();
  });

  it("reads TCGdex Cardmarket pricing in the API's field names", () => {
    const tcgdex = (priceFixture as unknown as { tcgdex: Record<string, unknown> }).tcgdex;
    const charizard = parseTcgdexCard(tcgdex["base1/4"])!;
    expect(charizard).toMatchObject({ name: "Charizard", localId: "4", reverse: false, tcgplayerProductIds: [42382] });
    expect(charizard.cardmarket?.idProduct).toBe(273699);
    expect(charizard.cardmarket?.updatedAt).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
    expect(charizard.cardmarket?.prices.trendPrice).toBeGreaterThan(0);
    // No reverse holo exists, so Cardmarket's foil columns aren't shown as one.
    expect(Object.keys(charizard.cardmarket!.prices).some((k) => k.startsWith("reverseHolo"))).toBe(false);

    const made = parseTcgdexCard({
      name: "Pineco",
      localId: "001",
      variants: { reverse: true },
      pricing: { cardmarket: { unit: "EUR", updated: "2026-10-26T22:54:32.944Z", idProduct: 7, trend: 0.2, avg: 0, low: 0.02, "trend-holo": 0.5 }, tcgplayer: { unit: "USD", normal: { productId: 11 }, reverse: { productId: 11 } } },
    })!;
    expect(made.cardmarket).toEqual({ idProduct: 7, updatedAt: "2026/10/26", prices: { trendPrice: 0.2, lowPrice: 0.02, reverseHoloTrend: 0.5 } });
    expect(made.tcgplayerProductIds).toEqual([11]);
    expect(parseTcgdexCard({ name: "X", localId: "1", pricing: { cardmarket: { unit: "USD", trend: 3 } } })?.cardmarket).toBeNull();
    expect(parseTcgdexCard({ id: "nope" })).toBeNull();
  });
});

describe("price provider (fixture data)", () => {
  const base = (over: Partial<TcgCard>): TcgCard => ({
    id: "base1-4",
    name: "Charizard",
    number: "4",
    set: { id: "base1", name: "Base", series: "Base", releaseDate: "1999/01/09" },
    pricesUnavailable: true,
    ...over,
  });

  beforeEach(() => {
    vi.stubEnv("POKEIQ_TCG_FIXTURE", "1");
    resetTcgcsvMemo();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("prices a fallback card from TCGplayer via TCGCSV, with source, date and product link", async () => {
    const [card] = await withPrices([base({})]);
    expect(card.pricesUnavailable).toBeUndefined();
    expect(card.priceSources?.tcgplayer).toBe("tcgcsv");
    expect(card.tcgplayer?.url).toBe("https://www.tcgplayer.com/product/42382");
    expect(card.tcgplayer?.updatedAt).toBe("2026/10/26");
    expect(tcgplayerRows(card)[0]).toMatchObject({ variant: "holofoil", label: "Holofoil" });
    const tile = toTile(card);
    expect(tile.price).toMatchObject({ currency: "USD", source: "tcgcsv", asOf: "2026/10/26" });
    expect(tile.price!.value).toBe(tcgplayerRows(card)[0].market);
    expect(priceSourceLine("TCGplayer", card.priceSources?.tcgplayer, card.tcgplayer?.updatedAt)).toBe("TCGplayer via TCGCSV · as of Oct 26, 2026");
    expect(tilePriceNote([tile])).toBe("Prices: TCGplayer market (USD) via TCGCSV, as of Oct 26, 2026.");
  });

  it("shows no price at all for a card it can't match", async () => {
    const [machamp, unknown] = await withPrices([base({ id: "base1-8", name: "Machamp", number: "8" }), base({ id: "base1-200", name: "Not A Card", number: "200" })]);
    for (const card of [machamp, unknown]) {
      expect(card.tcgplayer).toBeUndefined();
      expect(card.priceSources).toBeUndefined();
      expect(card.pricesUnavailable).toBeUndefined(); // known: there's no listing, not "unavailable"
      expect(headlinePrice(card)).toBeNull();
      expect(toTile(card).price).toBeNull();
    }
    expect(tilePriceNote([toTile(machamp)])).toBe("");
  });

  it("keeps the Pokémon TCG API's own prices when it has them", async () => {
    const api = base({ pricesUnavailable: undefined, tcgplayer: { url: "https://prices.pokemontcg.io/tcgplayer/base1-4", updatedAt: "2026/10/15", prices: { holofoil: { market: 954.65 } } } });
    const [card] = await withPrices([api]);
    expect(card.priceSources).toEqual({ tcgplayer: "pokemontcg" });
    expect(card.tcgplayer?.prices?.holofoil?.market).toBe(954.65);
    expect(toTile(card).price).toMatchObject({ value: 954.65, source: "pokemontcg", asOf: "2026/10/15" });
  });

  it("adds Cardmarket from TCGdex on card pages when TCGdex agrees it's the same card", async () => {
    const card = await withCardPrices(base({}));
    expect(card.priceSources).toEqual({ tcgplayer: "tcgcsv", cardmarket: "tcgdex" });
    expect(card.cardmarket?.url).toBe("https://www.cardmarket.com/en/Pokemon/Products?idProduct=273699");
    expect(card.cardmarket?.prices?.trendPrice).toBeGreaterThan(0);
    expect(card.cardmarket?.updatedAt).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
  });

  it("drops TCGdex's Cardmarket price when its card doesn't look like ours", async () => {
    // TCGdex's base1/8 is Machamp; under another name it must not be used.
    const wrongName = await withCardPrices(base({ id: "base1-8", name: "Not Machamp", number: "8" }));
    expect(wrongName.cardmarket).toBeUndefined();
    // Our TCGplayer match and TCGdex's disagree → TCGdex's links are suspect for this card.
    const conflict = await withCardPrices(base({ pricesUnavailable: undefined, tcgplayer: { url: "https://www.tcgplayer.com/product/1", prices: { holofoil: { market: 5 } } } }));
    expect(conflict.cardmarket).toBeUndefined();
  });

  it("keeps prices 'unavailable' when TCGCSV can't be reached", async () => {
    vi.stubEnv("POKEIQ_TCG_FIXTURE", "0");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    try {
      const [card] = await withPrices([base({})]);
      expect(card.pricesUnavailable).toBe(true);
      expect(card.tcgplayer).toBeUndefined();
      expect(tilePriceNote([toTile(card)])).toBe("Prices unavailable right now.");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends an identifying User-Agent and caches through Next's data cache", async () => {
    vi.stubEnv("POKEIQ_TCG_FIXTURE", "0");
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        const g = (priceFixture as unknown as { groups: Record<string, { products: unknown; prices: unknown }> }).groups["604"];
        return url.endsWith("/products") ? Response.json(g.products) : Response.json(g.prices, { headers: { "last-modified": "Mon, 26 Oct 2026 20:00:07 GMT" } });
      })
    );
    try {
      const [card] = await withPrices([base({})]);
      expect(card.priceSources?.tcgplayer).toBe("tcgcsv");
      expect(calls.map((c) => c.url).sort()).toEqual(["https://tcgcsv.com/tcgplayer/3/604/prices", "https://tcgcsv.com/tcgplayer/3/604/products"]);
      for (const c of calls) {
        expect((c.init.headers as Record<string, string>)["User-Agent"]).toMatch(/^PokeIQ\//);
        expect((c.init as { next?: { revalidate?: number } }).next?.revalidate).toBeGreaterThanOrEqual(12 * 3600);
      }
      // A second look within the cache window doesn't refetch.
      await withPrices([base({ id: "base1-58", name: "Pikachu", number: "58" })]);
      expect(calls).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
