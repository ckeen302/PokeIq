import { describe, expect, it } from "vitest";
import {
  atlasQuery,
  buildAtlasIndex,
  conditionLabel,
  groupByGen,
  levelText,
  mergeVersions,
  methodLabel,
  rowsFromPokeApi,
  type PokeApiEncounter,
  type RawRow,
} from "@/lib/pokemon/encounter-transform";

const detail = (chance: number, lo: number, hi: number, conds: string[] = [], method = "walk") => ({
  min_level: lo,
  max_level: hi,
  chance,
  method: { name: method },
  condition_values: conds.map((name) => ({ name })),
});
const enc = (area: string, versions: Record<string, ReturnType<typeof detail>[]>): PokeApiEncounter => ({
  location_area: { name: area, url: "" },
  version_details: Object.entries(versions).map(([v, d]) => ({ version: { name: v }, encounter_details: d })),
});
const area = (slug: string) => ({ loc: slug === "r201" ? "Route 201" : "Route 202" });

describe("rowsFromPokeApi", () => {
  it("splits morning/day/night rates when they differ", () => {
    const rows = rowsFromPokeApi(
      [enc("r201", { diamond: [detail(30, 2, 4, ["time-morning"]), detail(40, 2, 4, ["time-day"]), detail(20, 2, 4, ["time-night"])] })],
      area
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ver: "diamond", loc: "Route 201", m: "Grass", lv: "2–4", t: ["30%", "40%", "20%"] });
    expect(rows[0].r).toBeUndefined();
  });

  it("shows a dash for a time of day with no chance and keeps a flat rate flat", () => {
    const [timed] = rowsFromPokeApi([enc("r201", { diamond: [detail(10, 3, 3, ["time-morning"]), detail(10, 3, 3, ["time-day"])] })], area);
    expect(timed.t).toEqual(["10%", "10%", "—"]);
    const [flat] = rowsFromPokeApi([enc("r201", { diamond: [detail(50, 2, 3)] })], area);
    expect(flat.r).toBe("50%");
    expect(flat.t).toBeUndefined();
  });

  it("sums slots, merges level ranges, and treats a time-less detail as all day", () => {
    const [row] = rowsFromPokeApi([enc("r201", { red: [detail(20, 3, 5), detail(10, 4, 6)] })], area);
    expect(row).toMatchObject({ lv: "3–6", r: "30%" });
  });

  it("drops gens 8+ and Let's Go (other sources cover them) and rate-less methods", () => {
    const rows = rowsFromPokeApi([enc("r201", { sword: [detail(5, 1, 1)], "lets-go-pikachu": [detail(5, 1, 1)], red: [detail(100, 5, 5, [], "gift")] })], area);
    expect(rows.map((r) => r.ver)).toEqual(["red"]);
    expect(rows[0]).toMatchObject({ m: "Gift", lv: "5" });
    expect(rows[0].r).toBeUndefined();
  });

  it("keeps a condition as a note and collapses dual-slot rows", () => {
    const rows = rowsFromPokeApi(
      [enc("r201", { diamond: [detail(8, 2, 2, ["slot2-ruby"]), detail(8, 2, 2, ["slot2-emerald"]), detail(50, 2, 3, ["swarm-yes"])] })],
      area
    );
    expect(rows.find((r) => r.n?.startsWith("GBA slot"))?.n).toBe("GBA slot: Ruby, Emerald");
    expect(rows.find((r) => r.n === "Swarm")).toBeDefined();
    expect(rows).toHaveLength(2);
  });
});

describe("labels", () => {
  it("labels methods and conditions", () => {
    expect(methodLabel("walk", "Route 201")).toBe("Grass");
    expect(methodLabel("walk", "Mt. Coronet 1F")).toBe("Cave");
    expect(methodLabel("super-rod")).toBe("Super Rod");
    expect(methodLabel("only-one")).toBe("Static");
    expect(conditionLabel(["time-day", "swarm-no", "radar-on"])).toBe("PokéRadar");
    expect(levelText(5, 5)).toBe("5");
    expect(levelText(2, 4)).toBe("2–4");
  });
});

describe("mergeVersions", () => {
  const base = { loc: "Route 201", base: "Route 201", m: "Grass", lv: "2–4", t: ["30%", "40%", "20%"] as [string, string, string] };
  it("merges identical rows across versions in game order", () => {
    const rows = mergeVersions([
      { ...base, ver: "platinum" },
      { ...base, ver: "diamond" },
      { ...base, ver: "pearl" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].v).toEqual(["diamond", "pearl", "platinum"]);
  });

  it("keeps rows apart when any field differs", () => {
    const rows = mergeVersions([
      { ...base, ver: "diamond" },
      { ...base, ver: "pearl", lv: "2–3" },
      { ...base, ver: "platinum", t: ["30%", "40%", "10%"] },
    ]);
    expect(rows.map((r) => r.v)).toEqual([["diamond"], ["pearl"], ["platinum"]]);
  });

  it("links the atlas place only when it's unambiguous in the games' regions", () => {
    const idx = buildAtlasIndex([
      { name: "Route 201", region: "Sinnoh" },
      { name: "Route 1", region: "Kanto" },
      { name: "Route 1", region: "Johto" },
      { name: "Route 1", region: "Unova" },
    ]);
    expect(atlasQuery("Route 201", ["diamond"], idx)).toBe("Route 201 · Sinnoh");
    expect(atlasQuery("Route 1", ["black"], idx)).toBe("Route 1 · Unova");
    expect(atlasQuery("Route 1", ["heartgold"], idx)).toBeUndefined(); // Kanto and Johto
    expect(atlasQuery("Nowhere Cave", ["heartgold"], idx)).toBeUndefined();
    const [row] = mergeVersions([{ ...base, ver: "diamond" }], idx);
    expect(row.a).toBe("Route 201 · Sinnoh");
  });
});

describe("groupByGen", () => {
  const raw: RawRow[] = [
    { ver: "diamond", loc: "Route 201", base: "Route 201", m: "Grass", lv: "2", r: "50%" },
    { ver: "pearl", loc: "Route 201", base: "Route 201", m: "Grass", lv: "2", r: "50%" },
  ];
  it("groups newest first and fills games without a wild encounter", () => {
    const gens = groupByGen(raw, { id: 396, speciesGen: 4, evolvesFrom: undefined });
    expect(gens[0].g).toBe(9);
    const g4 = gens.find((g) => g.g === 4)!;
    expect(g4.rows[0]).toMatchObject({ v: ["diamond", "pearl"], loc: "Route 201" });
    expect(g4.rows.at(-1)).toMatchObject({ v: ["platinum", "heartgold", "soulsilver"], x: "Not found in the wild" });
    expect(gens.at(-1)!.g).toBe(4);
  });
  it("says where evolved forms come from, and skips Let's Go outside Kanto", () => {
    const gens = groupByGen([], { id: 398, speciesGen: 4, evolvesFrom: "Staravia" });
    expect(gens.find((g) => g.g === 4)!.rows[0].x).toBe("Evolve from Staravia");
    expect(gens.find((g) => g.g === 7)!.rows.find((r) => r.v.includes("lets-go-pikachu"))!.x).toBe("Not in this game");
    const kanto = groupByGen([], { id: 25, speciesGen: 1 });
    expect(kanto.find((g) => g.g === 7)!.rows.flatMap((r) => r.v)).toContain("lets-go-pikachu");
  });
});

describe("compaction and game membership", () => {
  const r = (over: Partial<RawRow>): RawRow => ({ ver: "diamond", loc: "Great Marsh", base: "Great Marsh", m: "Grass", lv: "22", r: "10%", ...over });
  it("folds rows that differ only by sub-area", () => {
    const rows = mergeVersions([r({ sub: "Area 1" }), r({ sub: "Area 2" }), r({ sub: "Area 10" }), r({ sub: "Area 3", lv: "24" })]);
    expect(rows).toHaveLength(2);
    expect(rows.find((x) => x.lv === "22")).toMatchObject({ loc: "Great Marsh", n: "Area 1, Area 2, Area 10" });
  });
  it("collapses identical rod rows across many places", () => {
    const rod = (loc: string) => r({ loc, base: loc, m: "Old Rod", lv: "5", r: "100%" });
    const rows = mergeVersions(["A", "B", "C", "D", "E"].map(rod));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ loc: "Most fishable water" });
    expect(mergeVersions(["A", "B"].map(rod))).toHaveLength(2);
  });
  it("says 'Not in this game' only where the species can't exist", () => {
    const gens = groupByGen([], { id: 600, speciesGen: 5, inGame: (v) => v !== "legends-arceus", evolvesFrom: "Klang" });
    const g8 = gens.find((g) => g.g === 8)!;
    expect(g8.rows.find((x) => x.v.includes("legends-arceus"))!.x).toBe("Not in this game");
    expect(g8.rows.find((x) => x.v.includes("sword"))!.x).toBe("Evolve from Klang");
  });
});
