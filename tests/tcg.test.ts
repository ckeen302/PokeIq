import { describe, expect, it } from "vitest";
import fixture from "@/lib/tcg/fixture.json";
import type { TcgCard, TcgSet } from "@/lib/tcg/types";
import {
  cardmarketRows,
  compareNumber,
  formatApiDate,
  formatPrice,
  groupSetsBySeries,
  headlinePrice,
  rarityRank,
  sortTiles,
  tcgplayerRows,
  toTile,
  variantLabel,
} from "@/lib/tcg/prices";
import { cleanSearch } from "@/lib/tcg/api";

const cards = fixture.cards as unknown as TcgCard[];
const sets = fixture.sets as unknown as TcgSet[];

describe("TCG price helpers", () => {
  it("labels TCGplayer variants", () => {
    expect(variantLabel("reverseHolofoil")).toBe("Reverse Holofoil");
    expect(variantLabel("1stEditionHolofoil")).toBe("1st Edition Holofoil");
    expect(variantLabel("someNewVariant")).toBe("Some New Variant");
  });

  it("orders variants and drops empty rows", () => {
    const card: TcgCard = {
      id: "x-1",
      name: "X",
      tcgplayer: { prices: { reverseHolofoil: { market: 2 }, normal: { low: 0.1, market: 0.2 }, holofoil: { low: null, mid: null, high: null, market: null } } },
    };
    const rows = tcgplayerRows(card);
    expect(rows.map((r) => r.variant)).toEqual(["normal", "reverseHolofoil"]);
    expect(rows[0]).toMatchObject({ label: "Normal", market: 0.2, low: 0.1, mid: null, high: null });
  });

  it("treats Cardmarket zeros as missing", () => {
    const rows = cardmarketRows({ id: "x", name: "X", cardmarket: { prices: { trendPrice: 1.5, germanProLow: 0, avg30: null, lowPrice: 0.02 } } });
    expect(rows.map((r) => r.key)).toEqual(["trendPrice", "lowPrice"]);
  });

  it("picks a headline price: TCGplayer market, then mid, then Cardmarket trend, else nothing", () => {
    expect(headlinePrice({ id: "a", name: "A", tcgplayer: { prices: { holofoil: { market: 9.5 } } } })).toEqual({ value: 9.5, currency: "USD", label: "Holofoil" });
    expect(headlinePrice({ id: "a", name: "A", tcgplayer: { prices: { normal: { mid: 3 } } } })?.value).toBe(3);
    expect(headlinePrice({ id: "a", name: "A", cardmarket: { prices: { trendPrice: 4.2 } } })).toEqual({ value: 4.2, currency: "EUR", label: "Cardmarket trend" });
    expect(headlinePrice({ id: "a", name: "A" })).toBeNull();
  });

  it("formats prices and API dates", () => {
    expect(formatPrice(1234.5, "USD")).toBe("$1,234.50");
    expect(formatPrice(0.1, "EUR")).toBe("€0.10");
    expect(formatApiDate("2026/10/15")).toBe("Oct 15, 2026");
    expect(formatApiDate("1999/01/09 00:00:00")).toBe("Jan 9, 1999");
    expect(formatApiDate(undefined)).toBeNull();
    expect(formatApiDate("soon")).toBeNull();
  });
});

describe("TCG mapping", () => {
  it("sorts collector numbers naturally", () => {
    expect(["10", "2", "TG10", "TG2", "1"].sort(compareNumber)).toEqual(["1", "2", "10", "TG2", "TG10"]);
  });

  it("ranks rarities, unknown after known, missing first", () => {
    expect(rarityRank("Common")).toBeLessThan(rarityRank("Special Illustration Rare"));
    expect(rarityRank("Brand New Rarity")).toBeGreaterThan(rarityRank("Hyper Rare"));
    expect(rarityRank(null)).toBe(-1);
  });

  it("maps real API cards to tiles without inventing fields", () => {
    const tiles = cards.map(toTile);
    for (const t of tiles) {
      expect(t.id).toBeTruthy();
      if (t.price) expect(t.price.value).toBeGreaterThan(0);
    }
    const trainer = cards.find((c) => c.supertype === "Trainer")!;
    expect(toTile(trainer).kinds).toEqual(["Trainer"]);
    const mon = cards.find((c) => c.types?.length)!;
    expect(toTile(mon).kinds).toEqual(mon.types);
  });

  it("sorts tiles by price with unpriced cards last", () => {
    const tiles = cards.map(toTile);
    const desc = sortTiles(tiles, "price-desc");
    const usd = desc.filter((t) => t.price?.currency === "USD").map((t) => t.price!.value);
    expect(usd).toEqual([...usd].sort((a, b) => b - a));
    const firstUnpriced = desc.findIndex((t) => !t.price);
    if (firstUnpriced !== -1) expect(desc.slice(firstUnpriced).every((t) => !t.price)).toBe(true);
    const byNumber = sortTiles(tiles.filter((t) => t.id.startsWith("base1-")), "number").map((t) => t.number);
    expect(byNumber.slice(0, 3)).toEqual(["1", "2", "3"]);
  });

  it("groups sets by series, newest first", () => {
    const groups = groupSetsBySeries(sets);
    const firstDates = groups.map((g) => g.sets[0].releaseDate!);
    expect(firstDates).toEqual([...firstDates].sort().reverse());
    for (const g of groups) {
      const d = g.sets.map((s) => s.releaseDate!);
      expect(d).toEqual([...d].sort().reverse());
      expect(g.sets.every((s) => s.series === g.series)).toBe(true);
    }
  });

  it("keeps search terms free of query syntax", () => {
    expect(cleanSearch('  Charizard" OR set.id:*  ')).toBe("Charizard OR set.id");
    expect(cleanSearch("Professor's Research")).toBe("Professor's Research");
    expect(cleanSearch("Flabébé")).toBe("Flabébé");
  });
});
