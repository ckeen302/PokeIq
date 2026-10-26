import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardsForDex, getCard, getSetCards, getSets, resetApiHealth, searchCards } from "@/lib/tcg/api";
import { rowToCard, setIdOf, type IndexRow } from "@/lib/tcg/fallback";
import { toTile } from "@/lib/tcg/prices";

const SETS = [
  { id: "base1", name: "Base", series: "Base", total: 102, releaseDate: "1999/01/09", updatedAt: "x", legalities: {}, images: { logo: "l" } },
  { id: "sv3pt5", name: "151", series: "Scarlet & Violet", total: 207, releaseDate: "2023/09/22", images: {} },
];
const BASE_CARDS = [
  { id: "base1-4", name: "Charizard", number: "4", rarity: "Rare Holo", supertype: "Pokémon", types: ["Fire"], nationalPokedexNumbers: [6], images: { small: "https://images.pokemontcg.io/base1/4.png" } },
  { id: "base1-10", name: "Mewtwo", number: "10", supertype: "Pokémon", types: ["Psychic"], nationalPokedexNumbers: [150] },
  { id: "base1-2", name: "Blastoise", number: "2", supertype: "Pokémon", types: ["Water"], nationalPokedexNumbers: [9] },
];

let apiCalls = 0;
beforeEach(() => {
  resetApiHealth();
  apiCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("https://api.pokemontcg.io")) {
        apiCalls++;
        return new Response("down", { status: 503 });
      }
      if (url.endsWith("/sets/en.json")) return Response.json(SETS);
      if (url.endsWith("/cards/en/base1.json")) return Response.json(BASE_CARDS);
      return new Response("nf", { status: 404 });
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("TCG static fallback", () => {
  it("serves sets newest first without API-only fields when the API is down", async () => {
    const sets = await getSets();
    expect(sets?.map((s) => s.id)).toEqual(["sv3pt5", "base1"]);
    expect(sets?.[1]).not.toHaveProperty("updatedAt");
  });

  it("serves a set's cards sorted by number, with the set attached and prices flagged unavailable", async () => {
    const cards = await getSetCards("base1");
    expect(cards?.map((c) => c.number)).toEqual(["2", "4", "10"]);
    expect(cards?.[0].set?.name).toBe("Base");
    expect(cards?.every((c) => c.pricesUnavailable)).toBe(true);
    expect(toTile(cards![1])).toMatchObject({ price: null, pricesUnavailable: true });
  });

  it("looks single cards up (profile pick validation) and returns null for unknown ones", async () => {
    expect((await getCard("base1-4"))?.name).toBe("Charizard");
    expect(await getCard("base1-999")).toBeNull();
  });

  it("stops calling the API for a while after a failure", async () => {
    await getSets();
    await getCard("base1-4");
    expect(apiCalls).toBe(1);
  });

  it("searches and finds species cards from the bundled index", async () => {
    const found = await searchCards("charizard", 500);
    expect(found?.length).toBeGreaterThan(20);
    expect(found?.every((c) => c.name.toLowerCase().includes("charizard"))).toBe(true);
    expect(found?.[0].pricesUnavailable).toBe(true);
    const dex = await cardsForDex(6, 10);
    expect(dex?.cards).toHaveLength(10);
    expect(dex!.total).toBeGreaterThan(20);
    expect(dex?.cards.every((c) => c.nationalPokedexNumbers?.includes(6))).toBe(true);
  });

  it("turns index rows into tile-ready cards", () => {
    const sets = new Map([["base1", SETS[0]]]);
    const poke = rowToCard(["base1-4", "Charizard", "4", "Rare Holo", ["Fire"], [6]] as IndexRow, sets);
    expect(poke).toMatchObject({ supertype: "Pokémon", types: ["Fire"], images: { small: "https://images.pokemontcg.io/base1/4.png", large: "https://images.pokemontcg.io/base1/4_hires.png" } });
    const trainer = rowToCard(["base1-91", "Bill", "91", "Common", ["Trainer"], 0] as IndexRow, sets);
    expect(trainer.supertype).toBe("Trainer");
    expect(trainer.types).toBeUndefined();
    expect(setIdOf("swsh12pt5gg-GG01")).toBe("swsh12pt5gg");
  });
});
