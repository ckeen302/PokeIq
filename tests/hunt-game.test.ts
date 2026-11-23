import { describe, expect, it } from "vitest";
import { areaDistance, curveScore, huntSquare, matchPins, type Point, type ScoreSpot } from "@/lib/hunt/score";
import { dealHunt, eligible } from "@/lib/hunt/deal";
import { HUNT_REGIONS, HUNT_ROUNDS, huntPinsFor, type HuntEntry } from "@/lib/hunt/types";
import { gradeHunt, huntEntries, huntRegionAt, huntTableProblems, readHunt, startHunt } from "@/lib/server/hunt";
import geo from "@/data/geo.json";

const MAP = { diagonal: 1000, perfectPx: 5 };
const dot = (x: number, y: number): Point[] => [[x, y]];
const spot = (region: ScoreSpot["region"], x: number, y: number): ScoreSpot => ({ region, area: dot(x, y) });

describe("Pokémon Hunt scoring", () => {
  it("is PokéGuessr's curve, full points on the spot", () => {
    expect(curveScore(MAP, 0, 5000)).toBe(5000);
    expect(curveScore(MAP, 5, 5000)).toBe(5000);
    expect(curveScore(MAP, 100, 5000)).toBeCloseTo(5000 * Math.exp(-1), 6);
    expect(curveScore(MAP, Infinity, 5000)).toBe(0);
    expect(areaDistance([0, 0], [[3, 4], [10, 10]])).toBe(5);
  });

  it("splits 5,000 across the pins, and three perfect pins make exactly 5,000", () => {
    const spots = [spot("kanto", 0, 0), spot("johto", 500, 0), spot("galar", 0, 500)];
    const r = matchPins(MAP, [[0, 0], [500, 0], [0, 500]], spots, 3);
    expect(r.total).toBe(5000);
    expect(r.pins.map((p) => p.score).reduce((a, b) => a + b)).toBe(5000);
    expect(new Set(r.pins.map((p) => p.region)).size).toBe(3);
  });

  it("doesn't care about the pins' order", () => {
    const spots = [spot("kanto", 0, 0), spot("johto", 300, 0), spot("galar", 0, 300)];
    const pins: Point[] = [[10, 10], [290, 20], [30, 280]];
    const a = matchPins(MAP, pins, spots, 3);
    const b = matchPins(MAP, [pins[2], pins[0], pins[1]], spots, 3);
    expect(a.total).toBe(b.total);
  });

  it("counts each region once: two pins on one region don't both score", () => {
    const spots = [spot("kanto", 0, 0), spot("johto", 900, 0)];
    const r = matchPins(MAP, [[0, 0], [1, 1]], spots, 2);
    expect(r.pins.map((p) => p.region).sort()).toEqual(["johto", "kanto"]);
    expect(r.total).toBeLessThan(2600);
  });

  it("matches optimally, not greedily", () => {
    // Pin A sits between both spots; pin B is right on Kanto. Greedy would give A Kanto; the best gives A Johto.
    const spots = [spot("kanto", 0, 0), spot("johto", 100, 0)];
    const r = matchPins(MAP, [[40, 0], [0, 0]], spots, 2);
    expect(r.pins[0].region).toBe("johto");
    expect(r.pins[1].region).toBe("kanto");
  });

  it("scores against the nearest spot in a region", () => {
    const spots = [spot("kanto", 0, 0), spot("kanto", 200, 0)];
    const r = matchPins(MAP, [[190, 0]], spots, 1);
    expect(r.pins[0].spot).toBe(1);
    expect(r.pins[0].distancePx).toBe(10);
  });

  it("missing pins score nothing, extra pins are ignored", () => {
    const spots = [spot("kanto", 0, 0), spot("johto", 500, 0)];
    expect(matchPins(MAP, [[0, 0]], spots, 2).total).toBe(2500);
    expect(matchPins(MAP, [[0, 0], [500, 0], [0, 0]], spots, 2).pins).toHaveLength(2);
    expect(matchPins(MAP, [], spots, 2).total).toBe(0);
  });

  it("takes one pin per region, at most three, and one on a region's map", () => {
    expect(huntPinsFor(1, "classic")).toBe(1);
    expect(huntPinsFor(2, "daily")).toBe(2);
    expect(huntPinsFor(7, "classic")).toBe(3);
    expect(huntPinsFor(7, "region")).toBe(1);
  });

  it("has share squares", () => {
    expect([5000, 4000, 3999, 2000, 600, 10].map(huntSquare).join("")).toBe("🟩🟩🟨🟨🟧🟥");
  });
});

const entry = (id: string, dex: number, difficulty: number, extra: Partial<HuntEntry> = {}): HuntEntry => ({
  id,
  dex,
  form: null,
  name: id,
  art: dex,
  slug: id,
  regions: ["kanto"],
  places: [],
  difficulty,
  regionDifficulty: { kanto: difficulty },
  ...extra,
});

describe("Pokémon Hunt dealing", () => {
  const pool = Array.from({ length: 30 }, (_, i) => entry(`p${i}`, i + 1, i / 30, i === 3 ? { famous: true } : i > 26 ? { everywhere: true } : {}));

  it("deals five different species, easy to hard, with a famous one", () => {
    const dealt = dealHunt(pool, "seed", { mode: "classic" });
    expect(dealt).toHaveLength(HUNT_ROUNDS);
    expect(new Set(dealt.map((e) => e.dex)).size).toBe(HUNT_ROUNDS);
    expect(dealt.map((e) => e.difficulty)).toEqual([...dealt.map((e) => e.difficulty)].sort((a, b) => a - b));
    expect(dealt.some((e) => e.famous)).toBe(true);
  });

  it("never deals an everywhere Pokémon on the world map", () => {
    for (let i = 0; i < 50; i++) expect(dealHunt(pool, `s${i}`, { mode: "classic" }).some((e) => e.everywhere)).toBe(false);
    expect(eligible(pool, "region", "kanto").some((e) => e.everywhere)).toBe(true);
  });

  it("is the same for the same seed, and keeps forms of one species apart", () => {
    expect(dealHunt(pool, "x", { mode: "daily" })).toEqual(dealHunt(pool, "x", { mode: "daily" }));
    const forms = [entry("52", 52, 0.2), entry("52-alola", 52, 0.3), ...pool.slice(0, 10)];
    for (let i = 0; i < 30; i++) expect(dealHunt(forms, `f${i}`, { mode: "classic" }).filter((e) => e.dex === 52).length).toBeLessThanOrEqual(1);
  });

  it("deals fresh Pokémon before recent ones", () => {
    const small = pool.slice(0, 8);
    const dealt = dealHunt(small, "r", { mode: "classic", recent: ["p0", "p1", "p2"] });
    expect(dealt.filter((e) => ["p0", "p1", "p2"].includes(e.id)).length).toBeLessThanOrEqual(0);
  });

  it("deals only the region's Pokémon in Region mode", () => {
    const mixed = [...pool.slice(0, 10), ...Array.from({ length: 10 }, (_, i) => entry(`j${i}`, 100 + i, 0.5, { regions: ["johto"], regionDifficulty: { johto: 0.5 } }))];
    for (const e of dealHunt(mixed, "j", { mode: "region", region: "johto" })) expect(e.regions).toContain("johto");
  });
});

describe("Pokémon Hunt on the server", () => {
  it("loads a table whose every place is on the map", () => {
    expect(huntTableProblems()).toEqual([]);
    expect(huntEntries().length).toBeGreaterThanOrEqual(HUNT_ROUNDS);
  });

  it("reads a pin's region from the map", () => {
    const world = (geo as unknown as { world: { map: { width: number; height: number }; locations: { name: string; region: string; pin?: [number, number] }[] } }).world;
    const at = (region: string, name: string) => {
      const l = world.locations.find((x) => x.region === region && x.name === name && x.pin)!;
      return [l.pin![0] * world.map.width, l.pin![1] * world.map.height] as Point;
    };
    expect(huntRegionAt(at("Kanto", "Pallet Town"))).toBe("kanto");
    expect(huntRegionAt(at("Sevii Islands", "Kindle Road"))).toBe("kanto");
    expect(huntRegionAt(at("Crown Tundra", "Freezington"))).toBe("galar");
    expect(huntRegionAt(at("Kitakami", "Mossui Town"))).toBe("kitakami");
  });

  it("never sends a place before the round is graded", () => {
    const start = startHunt({ mode: "classic" });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const json = JSON.stringify(start.body);
    const names = new Set(huntEntries().flatMap((e) => e.places.map((p) => p.name)));
    for (const name of names) expect(json.includes(`"${name}"`)).toBe(false);
    for (const r of HUNT_REGIONS) expect(json.toLowerCase().includes(`"${r}"`)).toBe(false);
    expect(Object.keys(start.body.round).sort()).toEqual(["art", "dex", "id", "index", "name", "pins", "regions"]);
  });

  it("plays a whole game: a pin on a real spot scores, and the reveal lists every spot", () => {
    const start = startHunt({ mode: "classic" });
    if (!start.ok) throw new Error(start.error);
    let token = start.body.token;
    let round = start.body.round;
    const W = 5850;
    const H = 2565;
    for (let i = 0; i < HUNT_ROUNDS; i++) {
      const e = huntEntries().find((x) => x.id === round.id)!;
      // A pin on the first place of each of its regions.
      const pins = e.regions.slice(0, round.pins).map((r) => {
        const p = e.places.find((pl) => pl.region === r)!;
        return { x: p.pin[0], y: p.pin[1] };
      });
      const state = readHunt(token)!;
      const g = gradeHunt(state, { pins });
      if (!g.ok) throw new Error(g.error);
      expect(g.body.score).toBeGreaterThan(4900);
      expect(g.body.reveal.found).toBe(round.pins);
      expect(g.body.reveal.spots.map((s) => s.name).sort()).toEqual(e.places.map((p) => p.name).sort());
      expect(g.body.reveal.dex).toBe(`/pokemon/${e.slug}#encounters`);
      token = g.body.token;
      if (g.body.next) round = g.body.next;
      if (i === HUNT_ROUNDS - 1) {
        expect(g.body.done).toBe(true);
        expect(g.body.result?.rounds).toHaveLength(HUNT_ROUNDS);
      }
      void W;
      void H;
    }
  });

  it("grades a round once, and a far pin scores little", () => {
    const start = startHunt({ mode: "classic" });
    if (!start.ok) throw new Error(start.error);
    const state = readHunt(start.body.token)!;
    const g = gradeHunt(state, { pins: [{ x: 0.001, y: 0.999 }] });
    if (!g.ok) throw new Error(g.error);
    expect(g.body.score).toBeLessThan(2500);
    expect(g.claimKey).toMatch(/^hunt:/);
  });

  it("scores a late guess as nothing", () => {
    const now = Date.now();
    const start = startHunt({ mode: "classic" }, now);
    if (!start.ok) throw new Error(start.error);
    const e = huntEntries().find((x) => x.id === start.body.round.id)!;
    const g = gradeHunt(readHunt(start.body.token, now)!, { pins: [{ x: e.places[0].pin[0], y: e.places[0].pin[1] }] }, now + 10 * 60_000);
    if (!g.ok) throw new Error(g.error);
    expect(g.body.score).toBe(0);
    expect(g.body.timedOut).toBe(true);
  });

  it("deals the same Daily to everyone", () => {
    const date = new Date().toISOString().slice(0, 10);
    const a = startHunt({ mode: "daily", date });
    const b = startHunt({ mode: "daily", date });
    if (!a.ok || !b.ok) throw new Error("daily failed");
    expect(a.body.round.id).toBe(b.body.round.id);
    expect(a.body.daily?.number).toBeGreaterThanOrEqual(1);
  });

  it("refuses an unknown region", () => {
    // @ts-expect-error: not a region with a map
    expect(startHunt({ mode: "region", region: "kitakami" }).ok).toBe(false);
  });
});
