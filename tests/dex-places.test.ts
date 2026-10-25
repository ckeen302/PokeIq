import { describe, expect, it } from "vitest";
import { groupByGame, invertEncounters, mostRecentShot, placeSlug, placeType, slugFromKey, versionRegions, type PlaceTags } from "@/lib/dex/places";
import type { EncGen } from "@/lib/pokemon/encounter-types";
import fs from "node:fs";
import path from "node:path";
import placesJson from "@/data/places.json";
import { PLACES, getPlace, placeIndex, wildAt, PSEUDO_LOCATIONS } from "@/lib/dex/places-data";

describe("invertEncounters with the places build's label map", () => {
  it("splits a row between regions per version and keeps the section as a note", () => {
    const enc: Record<string, { k: string; s?: string }> = {
      "Route 17|Unova": { k: "Route 17 · Unova" },
      "Route 17|Alola": { k: "Route 17 · Alola" },
      "Lost Tower5F|Sinnoh": { k: "Lost Tower · Sinnoh", s: "5F" },
      "Worn Bridge (Obsidian Fieldlands)|Hisui": { k: "Worn Bridge · Hisui" },
    };
    const files: [number, EncGen[]][] = [
      [1, [{ g: 5, rows: [{ v: ["black", "sun"], loc: "Route 17", m: "Surf" }, { v: ["pearl"], loc: "Lost Tower5F", m: "Grass", n: "Night" }, { v: ["legends-arceus"], loc: "Worn Bridge (Obsidian Fieldlands)", m: "Wild" }, { v: ["red"], loc: "Kanto", m: "Grass" }] }]],
    ];
    const { byPlace, unmatched } = invertEncounters(files, (loc, v) => {
      for (const r of versionRegions(v)) if (enc[`${loc}|${r}`]) return enc[`${loc}|${r}`];
      return null;
    });
    expect(byPlace.get("Route 17 · Unova")![0].v).toEqual(["black"]);
    expect(byPlace.get("Route 17 · Alola")![0].v).toEqual(["sun"]);
    expect(byPlace.get("Lost Tower · Sinnoh")![0].n).toBe("5F · Night");
    expect(byPlace.get("Worn Bridge · Hisui")).toHaveLength(1);
    expect([...unmatched]).toEqual(["Kanto"]);
  });
});

describe("places data (every region)", () => {
  it("has a page for every region's places, Hisui and the DLCs included, with unique slugs", () => {
    expect(new Set(PLACES.map((p) => p.slug)).size).toBe(PLACES.length);
    const regions = new Set(PLACES.map((p) => p.region));
    for (const r of ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Isle of Armor", "Crown Tundra", "Hisui", "Paldea", "Kitakami", "Blueberry Academy", "Sevii Islands"]) expect(regions.has(r), r).toBe(true);
    for (const slug of ["jubilife-village-hisui", "route-134-hoenn", "brooklet-hill-alola", "grand-underground-sinnoh", "wild-zone-1-kalos", "hyperspace-lumiose-kalos", "torchlit-labyrinth-blueberry-academy", "primeval-grotto-hisui", "coronet-highlands-hisui"])
      expect(getPlace(slug), slug).toBeDefined();
    expect(getPlace("primeval-grotto-hisui")!.parent).toBe("Coronet Highlands");
    expect(getPlace("wild-zone-1-kalos")!.parent).toBe("Lumiose City");
    expect(getPlace("jubilife-village-hisui")!.atlas).toBe(false);
    expect(getPlace("route-1-kanto")!.atlas).toBe(true);
  });

  it("maps every encounter label to a place, except documented non-places", () => {
    expect([...placeIndex().unmatched].filter((l) => !PSEUDO_LOCATIONS[l])).toEqual([]);
    expect(PSEUDO_LOCATIONS["Tera Raid Battles"]).toBeDefined();
  });

  it("spot-check: 10 new pages' wild rows each come from a species-file row mapped to that place", () => {
    const enc = (placesJson as unknown as { enc: Record<string, { k: string }> }).enc;
    const dir = path.join(process.cwd(), "src/data/encounters");
    const extra = PLACES.filter((p) => !p.atlas && wildAt(p.key).length);
    let seed = 7;
    const pick = new Set<(typeof extra)[number]>();
    while (pick.size < 10) pick.add(extra[(seed = (seed * 48271) % 2147483647) % extra.length]);
    for (const p of pick) {
      const rows = wildAt(p.key);
      let fileRows = 0;
      for (const id of new Set(rows.map((r) => r.id))) {
        const gens = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")).gens as EncGen[];
        for (const g of gens)
          for (const r of g.rows) {
            if (!r.loc || r.a || r.x) continue;
            const vs = r.v.filter((v) => versionRegions(v).some((reg) => enc[`${r.loc}|${reg}`]?.k === p.key));
            if (!vs.length) continue;
            fileRows++;
            expect(rows.some((w) => w.id === id && w.m === r.m && w.lv === r.lv && w.v.join() === vs.join()), `${p.key} #${id} ${r.loc}`).toBe(true);
          }
      }
      expect(fileRows, p.key).toBe(rows.length);
    }
  });
});

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
