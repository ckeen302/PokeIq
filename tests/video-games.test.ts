import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VIDEO_GAMES, formatRelease, getVideoGame, relatedGames, toCard } from "@/lib/dex/video-games";
import { DEFAULT_QUERY, KIND_FILTERS, applyGameQuery, gameQueryString, parseGameQuery } from "@/lib/dex/video-games-types";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { PLACES } from "@/lib/dex/places-data";
import { trainerGame } from "@/lib/trainers/games";

const PUBLIC = join(process.cwd(), "public");

describe("the Games tab's data", () => {
  it("has unique slugs that are safe in a URL", () => {
    const slugs = VIDEO_GAMES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("fills in every required field", () => {
    for (const g of VIDEO_GAMES) {
      expect(g.name, g.slug).toBeTruthy();
      expect(["mainline", "remake", "spinoff", "mobile"], g.slug).toContain(g.kind);
      expect(g.gen, g.slug).toBeGreaterThanOrEqual(1);
      expect(g.gen, g.slug).toBeLessThanOrEqual(9);
      expect(g.released, g.slug).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
      expect(Number.isNaN(Date.parse(g.released)), g.slug).toBe(false);
      expect(g.platform, g.slug).toBeTruthy();
      expect(g.platforms.length, g.slug).toBeGreaterThan(0);
      expect(g.summary.length, g.slug).toBeGreaterThan(40);
      expect(g.series, g.slug).toBeTruthy();
    }
  });

  it("lists the whole main series, from Red and Green to Legends: Z-A", () => {
    const core = VIDEO_GAMES.filter((g) => g.kind === "mainline" || g.kind === "remake").map((g) => g.slug);
    for (const slug of ["red-blue", "yellow", "gold-silver", "crystal", "ruby-sapphire", "emerald", "firered-leafgreen", "diamond-pearl", "platinum", "heartgold-soulsilver", "black-white", "black-2-white-2", "x-y", "omega-ruby-alpha-sapphire", "sun-moon", "ultra-sun-ultra-moon", "lets-go-pikachu-eevee", "sword-shield", "brilliant-diamond-shining-pearl", "legends-arceus", "scarlet-violet", "legends-z-a"]) {
      expect(core, slug).toContain(slug);
    }
  });

  it("has box art on disk for every game (both covers for a pair)", () => {
    for (const g of VIDEO_GAMES) {
      if (g.cover.kind === "box") {
        expect(g.cover.files.length, g.slug).toBe(g.cover.alts.length);
        for (const f of g.cover.files) expect(existsSync(join(PUBLIC, "games", f)), `${g.slug}: public/games/${f}`).toBe(true);
      } else {
        expect(existsSync(join(PUBLIC, "art", "160", `${g.cover.id}.webp`)), `${g.slug}: art ${g.cover.id}`).toBe(true);
        expect(g.cover.types.length, g.slug).toBeGreaterThan(0);
      }
    }
  });

  it("names only Pokémon that are in the Pokédex", () => {
    for (const g of VIDEO_GAMES) {
      const ids = [...(g.starters ?? []), ...(g.legendaries ?? []), ...(g.exclusives ?? []).flatMap((c) => c.ids)];
      for (const id of ids) expect(getPokemon(id), `${g.slug}: #${id}`).toBeDefined();
      for (const id of g.legendaries ?? []) {
        const p = getPokemon(id)!;
        expect(p.legendary || p.mythical, `${g.slug}: ${p.name} is not Legendary or Mythical`).toBe(true);
      }
    }
  });

  it("never lists a Pokémon as exclusive to both versions, or twice in one", () => {
    for (const g of VIDEO_GAMES) {
      if (!g.exclusives) continue;
      const [a, b] = g.exclusives;
      expect(new Set(a.ids).size, g.slug).toBe(a.ids.length);
      expect(new Set(b.ids).size, g.slug).toBe(b.ids.length);
      expect(a.ids.filter((id) => b.ids.includes(id)), g.slug).toEqual([]);
    }
  });

  it("links only to region lists and trainer pages the site has", () => {
    const regions = new Set(PLACES.map((p) => p.region));
    for (const g of VIDEO_GAMES) {
      if (g.placesRegion) expect(regions.has(g.placesRegion), `${g.slug}: ${g.placesRegion}`).toBe(true);
      if (g.trainers) expect(trainerGame(g.trainers), `${g.slug}: ${g.trainers}`).toBeDefined();
      if (g.map) expect(existsSync(join(PUBLIC, "geo", "maps", `${g.map}.webp`)), `${g.slug}: map ${g.map}`).toBe(true);
    }
  });

  it("dates DLC after the game itself", () => {
    for (const g of VIDEO_GAMES) for (const d of g.dlc ?? []) expect(d.released > g.released, `${g.slug}: ${d.name}`).toBe(true);
  });

  it("relates every game to others that exist, never to itself", () => {
    for (const g of VIDEO_GAMES) {
      const rel = relatedGames(g);
      expect(rel.length, g.slug).toBeGreaterThan(0);
      for (const r of rel) {
        expect(getVideoGame(r.game.slug), `${g.slug} → ${r.game.slug}`).toBeDefined();
        expect(r.game.slug).not.toBe(g.slug);
      }
      expect(new Set(rel.map((r) => r.game.slug)).size).toBe(rel.length);
    }
  });

  it("relates a main-series game to the one before and after it", () => {
    const rel = relatedGames(getVideoGame("sword-shield")!).map((r) => r.game.slug);
    expect(rel.slice(0, 2)).toEqual(["lets-go-pikachu-eevee", "brilliant-diamond-shining-pearl"]);
  });

  it("formats release dates", () => {
    expect(formatRelease("1996-02-27")).toBe("February 27, 1996");
    expect(formatRelease("2008-03")).toBe("March 2008");
  });
});

describe("the Games list's filter and sort", () => {
  const cards = VIDEO_GAMES.map(toCard);

  it("reads the URL query, ignoring anything unknown", () => {
    expect(parseGameQuery(new URLSearchParams(""))).toEqual(DEFAULT_QUERY);
    expect(parseGameQuery(new URLSearchParams("kind=remake&gen=3&sort=oldest"))).toEqual({ kind: "remake", gen: 3, sort: "oldest" });
    expect(parseGameQuery(new URLSearchParams("kind=nope&gen=12&sort=sideways"))).toEqual(DEFAULT_QUERY);
    expect(parseGameQuery({ kind: "mobile" })).toEqual({ ...DEFAULT_QUERY, kind: "mobile" });
  });

  it("writes only what differs from the default, and reads it back", () => {
    expect(gameQueryString(DEFAULT_QUERY)).toBe("");
    const q = { kind: "spinoff", gen: 4, sort: "oldest" } as const;
    expect(gameQueryString(q)).toBe("?kind=spinoff&gen=4&sort=oldest");
    expect(parseGameQuery(new URLSearchParams(gameQueryString(q).slice(1)))).toEqual(q);
  });

  it("shows every game newest first by default", () => {
    const all = applyGameQuery(cards, DEFAULT_QUERY);
    expect(all.length).toBe(cards.length);
    for (let i = 1; i < all.length; i++) expect(all[i - 1].released >= all[i].released).toBe(true);
  });

  it("filters by kind and generation, and sorts oldest first", () => {
    const remakes = applyGameQuery(cards, { kind: "remake", gen: null, sort: "oldest" });
    expect(remakes.length).toBeGreaterThan(0);
    expect(remakes.every((g) => g.kind === "remake")).toBe(true);
    expect(remakes[0].slug).toBe("firered-leafgreen");
    const gen1 = applyGameQuery(cards, { kind: "mainline", gen: 1, sort: "oldest" });
    expect(gen1.map((g) => g.slug)).toEqual(["red-blue", "yellow"]);
  });

  it("has games under every chip", () => {
    for (const f of KIND_FILTERS) expect(applyGameQuery(cards, { ...DEFAULT_QUERY, kind: f.id }).length, f.id).toBeGreaterThan(0);
  });
});

describe("the Games pages in the sitemap", () => {
  it("lists the list and every game", async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    const urls = new Set((await sitemap()).map((e) => new URL(e.url).pathname));
    expect(urls.has("/pokedex/games")).toBe(true);
    for (const g of VIDEO_GAMES) expect(urls.has(`/pokedex/games/${g.slug}`), g.slug).toBe(true);
  });
});
