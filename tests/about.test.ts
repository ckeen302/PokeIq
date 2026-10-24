import { beforeEach, describe, expect, it } from "vitest";
import { GAME_SLOTS, POKEMON_SLOTS, STARTER_BASES } from "@/lib/about-data";
import { allowedFor, checkAbout, optionsFor, pokemonName, readAbout } from "@/lib/about-validate";
import { clearMemoryAbout, memoryAboutStore, saveAbout, aboutFor } from "@/lib/server/about";

const ok = (raw: unknown) => {
  const r = checkAbout(raw);
  if (!r.ok) throw new Error(r.error);
  return r.about;
};

describe("about me: slots and lists", () => {
  it("has the 15 Pokémon and 11 game slots with unique ids", () => {
    expect(POKEMON_SLOTS).toHaveLength(15);
    expect(GAME_SLOTS).toHaveLength(11);
    expect(new Set(POKEMON_SLOTS.map((s) => s.id)).size).toBe(15);
    for (const s of GAME_SLOTS) {
      expect(s.choices.length).toBeGreaterThan(5);
      expect(new Set(s.choices.map((c) => c.id)).size).toBe(s.choices.length);
    }
  });
});

describe("about me: Pokémon validation", () => {
  it("accepts any species and form in free slots, rejecting unknown ids", () => {
    expect(ok({ pokemon: { favorite: { id: 25, shiny: true }, "second-favorite": { id: 10034, shiny: false } } }).pokemon.favorite).toEqual({ id: 25, shiny: true });
    for (const id of [0, 1026, 9999, 10999, -1, 1.5, "25", null]) expect(checkAbout({ pokemon: { favorite: { id, shiny: false } } }).ok).toBe(false);
  });
  it("rejects unknown slots and malformed bodies", () => {
    expect(checkAbout({ pokemon: { bogus: { id: 25 } } }).ok).toBe(false);
    expect(checkAbout({ games: { bogus: "red" } }).ok).toBe(false);
    for (const bad of [null, "x", 3, [], { pokemon: [] }, { games: "red" }]) expect(checkAbout(bad).ok).toBe(false);
    expect(checkAbout({ pokemon: { favorite: { id: 25, shiny: "yes" } } }).ok).toBe(false);
  });
  it("drops cleared (null) slots", () => {
    expect(ok({ pokemon: { favorite: null }, games: { rival: null } })).toEqual({ pokemon: {}, games: {} });
  });
  it("Best Starter: starter lines only", () => {
    for (const id of [1, 2, 3, 7, 9, 906, 908, 912, 914]) expect(allowedFor("starter", id)).toBe(true);
    expect(allowedFor("starter", 25)).toBe(false);
    expect(allowedFor("starter", 150)).toBe(false);
    expect(checkAbout({ pokemon: { "best-starter": { id: 25, shiny: false } } }).ok).toBe(false);
    expect(checkAbout({ pokemon: { "best-starter": { id: 6, shiny: false } } }).ok).toBe(true);
    for (const base of STARTER_BASES) expect(allowedFor("starter", base)).toBe(true);
  });
  it("Best Mega: Mega forms only", () => {
    expect(checkAbout({ pokemon: { "best-mega": { id: 10034, shiny: false } } }).ok).toBe(true);
    expect(checkAbout({ pokemon: { "best-mega": { id: 6, shiny: false } } }).ok).toBe(false);
    expect(checkAbout({ pokemon: { "best-mega": { id: 10195, shiny: false } } }).ok).toBe(false);
  });
  it("Best Dynamax: Gigantamax forms only", () => {
    expect(checkAbout({ pokemon: { "best-dynamax": { id: 10196, shiny: false } } }).ok).toBe(true);
    expect(checkAbout({ pokemon: { "best-dynamax": { id: 10034, shiny: false } } }).ok).toBe(false);
    expect(checkAbout({ pokemon: { "best-dynamax": { id: 6, shiny: false } } }).ok).toBe(false);
  });
  it("Best Regional Variant: Alolan, Galarian, Hisuian, Paldean forms only", () => {
    for (const id of [10100, 10161, 10229, 10253]) expect(allowedFor("regional", id)).toBe(true);
    expect(allowedFor("regional", 10093)).toBe(false); // totem
    expect(allowedFor("regional", 10034)).toBe(false);
    expect(allowedFor("regional", 26)).toBe(false);
  });
  it("Best Eeveelution: the eight evolutions only", () => {
    for (const id of [134, 135, 136, 196, 197, 470, 471, 700]) expect(allowedFor("eeveelution", id)).toBe(true);
    expect(allowedFor("eeveelution", 133)).toBe(false);
    expect(allowedFor("eeveelution", 10205)).toBe(false);
    expect(optionsFor("eeveelution")).toHaveLength(8);
  });
  it("Best-Looking Shiny forces shiny on", () => {
    expect(ok({ pokemon: { "best-shiny": { id: 6, shiny: false } } }).pokemon["best-shiny"].shiny).toBe(true);
    expect(ok({ pokemon: { favorite: { id: 6 } } }).pokemon.favorite.shiny).toBe(false);
  });
  it("names species and forms", () => {
    expect(pokemonName(25)).toBeTruthy();
    expect(pokemonName(10034)).toMatch(/Charizard/);
    expect(pokemonName(5000)).toBeNull();
  });
});

describe("about me: game validation", () => {
  it("accepts only choices from the slot's fixed list", () => {
    expect(ok({ games: { "favorite-game": "emerald", "best-region": "unova", professor: "professor-oak" } }).games["favorite-game"]).toBe("emerald");
    expect(checkAbout({ games: { "favorite-game": "Emerald" } }).ok).toBe(false);
    expect(checkAbout({ games: { "favorite-game": "kanto" } }).ok).toBe(false);
    expect(checkAbout({ games: { "best-region": "red" } }).ok).toBe(false);
    expect(checkAbout({ games: { rival: "<script>" } }).ok).toBe(false);
    expect(checkAbout({ games: { rival: 5 } }).ok).toBe(false);
  });
  it("covers the lists the brief asks for", () => {
    const ids = (slot: string) => GAME_SLOTS.find((s) => s.id === slot)!.choices.map((c) => c.id);
    expect(ids("favorite-game")).toEqual(expect.arrayContaining(["red", "heartgold", "omega-ruby", "legends-arceus", "violet", "legends-z-a"]));
    expect(ids("gym-leader")).toEqual(expect.arrayContaining(["brock", "cynthia", "leon", "geeta", "tate-and-liza"]));
    expect(ids("villain-team")).toEqual(expect.arrayContaining(["team-rocket", "team-star", "team-skull"]));
  });
});

describe("about me: reading stored data", () => {
  it("keeps valid slots and drops stale ones", () => {
    const got = readAbout({ pokemon: { favorite: { id: 25, shiny: false }, "best-mega": { id: 6, shiny: false }, gone: { id: 1 } }, games: { rival: "blue", professor: "nobody" } });
    expect(got).toEqual({ pokemon: { favorite: { id: 25, shiny: false } }, games: { rival: "blue" } });
    expect(readAbout(null)).toEqual({ pokemon: {}, games: {} });
  });
});

describe("about me: store", () => {
  beforeEach(clearMemoryAbout);
  it("saves validated data per user and reads it back", async () => {
    const store = memoryAboutStore();
    const out = await saveAbout("u1", { pokemon: { favorite: { id: 25, shiny: true } }, games: { rival: "blue" } }, store);
    expect(out.ok).toBe(true);
    expect((await aboutFor("u1", store)).games.rival).toBe("blue");
    expect(await aboutFor("u2", store)).toEqual({ pokemon: {}, games: {} });
  });
  it("refuses invalid data without writing", async () => {
    const store = memoryAboutStore();
    const out = await saveAbout("u1", { pokemon: { "best-mega": { id: 25, shiny: false } } }, store);
    expect(out).toMatchObject({ ok: false, status: 400 });
    expect(await aboutFor("u1", store)).toEqual({ pokemon: {}, games: {} });
  });
});
