import { describe, expect, it } from "vitest";
import { groupByGame, invertEncounters, mostRecentShot, placeSlug, placeType, slugFromKey, type PlaceTags } from "@/lib/dex/places";
import type { EncGen } from "@/lib/pokemon/encounter-types";

const tags: PlaceTags = {
  gyms: new Set(["Kanto|Pewter Gym", "Galar|Motostoke Stadium"]),
  towns: new Set(["Galar|Postwick", "Kanto|Pewter City"]),
  routes: new Set(["Kanto|Route 1"]),
};

describe("placeType", () => {
  it("reads the theme lists and names only", () => {
    expect(placeType({ name: "Pewter Gym", region: "Kanto", parent: "Pewter City" }, tags)).toBe("Gym");
    expect(placeType({ name: "Motostoke Stadium", region: "Galar", parent: "Motostoke" }, tags)).toBe("Gym");
    expect(placeType({ name: "Route 1", region: "Kanto" }, tags)).toBe("Route");
    expect(placeType({ name: "Pewter City", region: "Kanto" }, tags)).toBe("City");
    expect(placeType({ name: "Pallet Town", region: "Kanto" }, tags)).toBe("Town");
    expect(placeType({ name: "Postwick", region: "Galar" }, tags)).toBe("Town");
    expect(placeType({ name: "Viridian Forest", region: "Kanto" }, tags)).toBe("Forest");
    expect(placeType({ name: "Rock Tunnel", region: "Kanto" }, tags)).toBe("Cave");
    expect(placeType({ name: "Mt. Moon", region: "Kanto" }, tags)).toBe("Mountain");
    expect(placeType({ name: "Pokémon Tower", region: "Kanto" }, tags)).toBe("Tower");
    expect(placeType({ name: "Bill's House", region: "Kanto", parent: "Route 25" }, tags)).toBe("Building");
    expect(placeType({ name: "Wild Area", region: "Galar" }, tags)).toBe("Other");
  });
});

describe("mostRecentShot", () => {
  it("picks the newest family by release order", () => {
    const shots = [
      { id: "a", game: "Let's Go", family: "lgpe" },
      { id: "b", game: "RBY", family: "rby" },
      { id: "c", game: "HGSS", family: "hgss" },
    ];
    expect(mostRecentShot(shots)?.id).toBe("a");
    expect(mostRecentShot([{ id: "x", game: "SV", family: "sv" }, { id: "y", game: "Z-A", family: "za" }])?.id).toBe("y");
    expect(mostRecentShot([])).toBeNull();
  });
});

describe("slugs", () => {
  it("round-trips atlas keys", () => {
    expect(placeSlug({ name: "Route 1", region: "Kanto" })).toBe("route-1-kanto");
    expect(slugFromKey("Route 1 · Kanto")).toBe("route-1-kanto");
    expect(slugFromKey("nope")).toBeNull();
  });
});

describe("invertEncounters", () => {
  const files: [number, EncGen[]][] = [
    [16, [{ g: 1, rows: [{ v: ["red", "blue"], loc: "Route 1", a: "Route 1 · Kanto", m: "Grass", lv: "2–5", r: "50%" }, { v: ["red"], loc: "Somewhere Odd", m: "Grass" }] }]],
    [19, [{ g: 1, rows: [{ v: ["red", "blue"], loc: "Route 1", a: "Route 1 · Kanto", m: "Grass", lv: "2–4", r: "50%" }, { v: ["yellow"], x: "Not found in the wild" }] }]],
    [163, [{ g: 2, rows: [{ v: ["gold"], loc: "Route 1", a: "Route 1 · Kanto", m: "Grass", lv: "2", t: ["—", "—", "30%"] }] }]],
  ];
  it("keeps only atlas-matched rows and groups them by game", () => {
    const { byPlace, matched, unmatched } = invertEncounters(files);
    expect([...byPlace.keys()]).toEqual(["Route 1 · Kanto"]);
    expect(byPlace.get("Route 1 · Kanto")!.map((r) => r.id)).toEqual([16, 19, 163]);
    expect([...matched]).toEqual(["Route 1"]);
    expect([...unmatched]).toEqual(["Somewhere Odd"]);
    const games = groupByGame(byPlace.get("Route 1 · Kanto")!);
    expect(games.map((g) => g.versions.join())).toEqual(["red,blue", "gold"]);
    expect(games[1].rows[0].t).toEqual(["—", "—", "30%"]);
  });
});
