import { describe, expect, it } from "vitest";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { matchesDexQuery, searchDex, type DexSearchEntry } from "@/lib/pokemon/dex-search";
import { geoDailyFirstShot, startGeo } from "@/lib/server/geo";
import { geoDailyRegion } from "@/lib/geo-types";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const ENTRIES: DexSearchEntry[] = POKEDEX.map((p) => [p.id, p.slug, p.name, p.genus]);
const names = (q: string, limit?: number) => searchDex(ENTRIES, q, limit).map((e) => e[2]);

describe("Pokédex search (the Pokédex list and the home page's box)", () => {
  it("matches names, categories and numbers like the Pokédex list", () => {
    const pikachu = POKEDEX.find((p) => p.slug === "pikachu")!;
    expect(matchesDexQuery(pikachu, "pika")).toBe(true);
    expect(matchesDexQuery(pikachu, "mouse")).toBe(true);
    expect(matchesDexQuery(pikachu, "25")).toBe(true);
    expect(matchesDexQuery(pikachu, "2")).toBe(true);
    expect(matchesDexQuery(pikachu, "26")).toBe(false);
    expect(matchesDexQuery(pikachu, "")).toBe(true);
  });

  it("ranks the exact name, then names that start with it, then later words", () => {
    expect(names("pikachu")[0]).toBe("Pikachu");
    expect(names("char", 3)).toEqual(["Charmander", "Charmeleon", "Charizard"]);
    expect(names("mime")).toContain("Mr. Mime");
    expect(names("farfetchd")[0]).toBe("Farfetch’d");
    expect(names("flabebe")[0]).toBe("Flabébé");
  });

  it("finds numbers, the exact one first", () => {
    expect(searchDex(ENTRIES, "25")[0][0]).toBe(25);
    expect(searchDex(ENTRIES, "006")[0][0]).toBe(6);
  });

  it("forgives a typo only when nothing matches", () => {
    expect(names("pikahcu")[0]).toBe("Pikachu");
    expect(names("charzard")).toContain("Charizard");
    expect(names("zzzzzzzzzz")).toEqual([]);
    expect(names("   ")).toEqual([]);
  });
});

describe("the Daily's first picture for the home page", () => {
  it("is the picture the Daily deals first, and only its URL", () => {
    const today = new Date().toISOString().slice(0, 10);
    const first = geoDailyFirstShot(today)!;
    const region = geoDailyRegion(today, true);
    const started = startGeo({ region, kind: "game", daily: today });
    expect(first.shot).toBe(started.round.shot);
    expect(first.shot).toMatch(/^\/api\/geo\/shot\/[A-Za-z0-9_-]+$/);
    expect(Object.keys(first).every((k) => k === "shot" || k === "blur" || k === "sharpTo")).toBe(true);
  });

  it("says only coarsely how big the picture can be drawn and stay sharp", () => {
    const day = Date.parse("2026-11-01T00:00:00Z");
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const { sharpTo } = geoDailyFirstShot(new Date(day + i * 86_400_000).toISOString().slice(0, 10))!;
      // Steps of 100 px, and nothing between 0 and 500: an old handheld game's picture never reads as big.
      expect(sharpTo % 100).toBe(0);
      expect(sharpTo === 0 || sharpTo >= 500).toBe(true);
      seen.add(sharpTo);
    }
    // Both kinds of day come up: a sharp modern picture, and one that stays off the hero.
    expect(seen.has(0)).toBe(true);
    expect([...seen].some((w) => w >= 800)).toBe(true);
  });
});
