import { describe, expect, it } from "vitest";
import { areaDistance, nearestSpot, scorePin, type Point, type ScoreMap, type ScoreSpot } from "@/lib/hunt/score";
import { geoCurveScore } from "@/lib/geo-curve";
import { GEO_FALLOFF, GEO_MAX_ROUND_SCORE } from "@/lib/geo-types";
import { dealHunt, easyPool, eligible, HUNT_MAX_REGION_SPOTS, spotsOnRegionMap } from "@/lib/hunt/deal";
import { HUNT_HINTS, HUNT_HINT_COSTS, HUNT_MAP_REGIONS, HUNT_REGIONS, HUNT_ROUNDS, huntAfterHints, huntScales, type HuntEntry, type HuntPlace } from "@/lib/hunt/types";
import { gradeHunt, hintFor, huntEntries, huntGamesOf, huntHintKey, huntPlaceKindsOf, huntRegionAt, huntRoundKey, huntTableProblems, readHunt, readHuntResult, startHunt } from "@/lib/server/hunt";
import geo from "@/data/geo.json";

const MAP: ScoreMap = { diagonal: () => 1000, perfectPx: 14, squarePx: 28 };
const dot = (x: number, y: number): Point[] => [[x, y]];
const spot = (region: ScoreSpot["region"], x: number, y: number): ScoreSpot => ({ region, area: dot(x, y) });
const WORLD = (geo as unknown as { world: { map: { width: number; height: number; squarePx: number }; crops: Record<string, { box: [number, number, number, number]; regions: string[] }> } }).world;

describe("Pokémon Hunt scoring", () => {
  it("is PokéGuessr's own curve: the same function the game grades with", () => {
    // geoCurveScore is GeoGuessr's 5000 · e^(−10 · d / D) with full points within half a square.
    expect(geoCurveScore(0, 1000, 14)).toBe(GEO_MAX_ROUND_SCORE);
    expect(geoCurveScore(14, 1000, 14)).toBe(GEO_MAX_ROUND_SCORE);
    expect(geoCurveScore(100, 1000, 14)).toBe(Math.round(5000 * Math.exp((-GEO_FALLOFF * 100) / 1000)));
    expect(scorePin(MAP, [100, 0], [spot("kanto", 0, 0)]).score).toBe(geoCurveScore(100, 1000, 14));
  });

  it("gives an exact pin full points, a close one most, and the right region alone little", () => {
    const spots = [spot("kanto", 0, 0)];
    expect(scorePin(MAP, [0, 0], spots)).toMatchObject({ score: 5000, squares: 0, spot: 0, region: "kanto" });
    // Two town-map squares off (56 px): still most of the points.
    expect(scorePin(MAP, [56, 0], spots).score).toBeGreaterThan(2800);
    // Across the region (400 px on a 1,000 px region map): little.
    expect(scorePin(MAP, [400, 0], spots).score).toBeLessThan(150);
  });

  it("scores against the nearest real spot, wherever the others are", () => {
    const spots = [spot("kanto", 0, 0), spot("johto", 1000, 0), spot("johto", 500, 500)];
    expect(nearestSpot([480, 480], spots).spot).toBe(2);
    const r = scorePin(MAP, [480, 480], spots);
    expect(r.spot).toBe(2);
    expect(r.region).toBe("johto");
    expect(r.distancePx).toBe(Math.round(Math.hypot(20, 20) * 10) / 10);
    expect(areaDistance([3, 4], [[0, 0], [100, 100]])).toBe(5);
  });

  it("uses the nearest spot's region's own map as the scale (as PokéGuessr on that map)", () => {
    const scaled: ScoreMap = { ...MAP, diagonal: (r) => (r === "alola" ? 2000 : 1000) };
    expect(scorePin(scaled, [200, 0], [spot("alola", 0, 0)]).score).toBeGreaterThan(scorePin(scaled, [200, 0], [spot("kanto", 0, 0)]).score);
    const scales = huntScales(WORLD.crops);
    for (const r of HUNT_MAP_REGIONS) expect(scales[r]).toBeCloseTo(Math.hypot(WORLD.crops[r].box[2] - WORLD.crops[r].box[0], WORLD.crops[r].box[3] - WORLD.crops[r].box[1]));
    // Kitakami has no map of its own: the mean of the others.
    expect(scales.kitakami).toBeGreaterThan(Math.min(...HUNT_MAP_REGIONS.map((r) => scales[r])));
  });

  it("scores no pin as nothing", () => {
    expect(scorePin(MAP, null, [spot("kanto", 0, 0)]).score).toBe(0);
    expect(scorePin(MAP, [0, 0], []).score).toBe(0);
  });

  it("takes each hint's cost off the round, never below zero", () => {
    expect(huntAfterHints(5000, [])).toBe(5000);
    expect(huntAfterHints(5000, ["type"])).toBe(5000 - HUNT_HINT_COSTS.type);
    expect(huntAfterHints(5000, [...HUNT_HINTS])).toBe(5000 - HUNT_HINT_COSTS.type - HUNT_HINT_COSTS.place - HUNT_HINT_COSTS.games);
    expect(huntAfterHints(300, ["games"])).toBe(0);
    for (const h of HUNT_HINTS) expect(HUNT_HINT_COSTS[h]).toBeGreaterThan(0);
  });
});

const place = (geoRegion: string, name: string): HuntPlace => ({ region: geoRegion === "Johto" ? "johto" : "kanto", geoRegion, name, pin: [0.5, 0.5], methods: [{ versions: ["red"], games: "Red", method: "Grass" }] });
const entry = (id: string, dex: number, difficulty: number, extra: Partial<HuntEntry> = {}): HuntEntry => ({
  id,
  dex,
  form: null,
  name: id,
  art: dex,
  slug: id,
  types: ["normal"],
  regions: ["kanto"],
  places: [place("Kanto", `${id} A`), place("Kanto", `${id} B`)],
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
    const mixed = [...pool.slice(0, 10), ...Array.from({ length: 10 }, (_, i) => entry(`j${i}`, 100 + i, 0.5, { regions: ["johto"], regionDifficulty: { johto: 0.5 }, places: [place("Johto", "A"), place("Johto", "B")] }))];
    for (const e of dealHunt(mixed, "j", { mode: "region", region: "johto" })) expect(e.regions).toContain("johto");
  });

  it("needs a real where: a few distinct places, not one obscure spot and not everywhere", () => {
    const lone = entry("lone", 500, 0.5, { places: [place("Kanto", "Only")] });
    const lonelyFamous = entry("star", 501, 0.5, { famous: true, places: [place("Kanto", "Only")] });
    const crowded = entry("crowd", 502, 0.5, { places: Array.from({ length: HUNT_MAX_REGION_SPOTS + 1 }, (_, i) => place("Kanto", `R${i}`)) });
    const ok = eligible([lone, lonelyFamous, crowded, ...pool], "classic").map((e) => e.id);
    expect(ok).not.toContain("lone");
    expect(ok).toContain("star");
    expect(spotsOnRegionMap(crowded, "kanto")).toBe(HUNT_MAX_REGION_SPOTS + 1);
    expect(eligible([crowded], "region", "kanto")).toEqual([]);
  });

  it("deals famous Pokémon in their home region on Easy, and any of them on Hard", () => {
    const famous = Array.from({ length: 8 }, (_, i) => entry(`f${i}`, 300 + i, 0.9, { famous: true, home: "kanto" }));
    const all = [...pool, ...famous, entry("away", 400, 0.1, { famous: true, home: "johto", regions: ["kanto"] })];
    expect(easyPool(all, "region", "kanto").map((e) => e.id)).not.toContain("away");
    for (let i = 0; i < 20; i++) for (const e of dealHunt(all, `e${i}`, { mode: "classic", difficulty: "easy" })) expect(e.famous && e.home).toBeTruthy();
    const hard = new Set<string>();
    for (let i = 0; i < 40; i++) for (const e of dealHunt(all, `h${i}`, { mode: "classic", difficulty: "hard" })) hard.add(e.id);
    // Hard is any of them: well beyond the famous ones, and never an everywhere one.
    expect([...hard].filter((id) => id.startsWith("p")).length).toBeGreaterThan(10);
    expect([...hard].some((id) => all.find((e) => e.id === id)!.everywhere)).toBe(false);
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
    expect(Object.keys(start.body.round).sort()).toEqual(["art", "dex", "hints", "id", "index", "name"]);
  });

  it("plays a whole game: a pin on a real spot scores 5,000, and the reveal lists every spot", () => {
    const start = startHunt({ mode: "classic" });
    if (!start.ok) throw new Error(start.error);
    let token = start.body.token;
    let round = start.body.round;
    for (let i = 0; i < HUNT_ROUNDS; i++) {
      const e = huntEntries().find((x) => x.id === round.id)!;
      const p = e.places[e.places.length - 1];
      const state = readHunt(token)!;
      const g = gradeHunt(state, { pins: [{ x: p.pin[0], y: p.pin[1] }] });
      if (!g.ok) throw new Error(g.error);
      expect(g.body.score).toBe(5000);
      expect(g.body.reveal.pins).toHaveLength(1);
      expect(g.body.reveal.pins[0].squares).toBe(0);
      expect(g.body.reveal.spots[g.body.reveal.pins[0].spot!].name).toBe(p.name);
      expect(g.body.reveal.spots.map((s) => s.name).sort()).toEqual(e.places.map((x) => x.name).sort());
      expect(g.body.reveal.dex).toBe(`/pokemon/${e.slug}#encounters`);
      token = g.body.token;
      if (g.body.next) round = g.body.next;
      if (i === HUNT_ROUNDS - 1) {
        expect(g.body.done).toBe(true);
        expect(g.body.result?.rounds).toHaveLength(HUNT_ROUNDS);
        expect(g.body.result?.score).toBe(25000);
      }
    }
  });

  it("charges a hint on the server, from the token or from the claim an older token can't hide", () => {
    const start = startHunt({ mode: "classic" });
    if (!start.ok) throw new Error(start.error);
    const e = huntEntries().find((x) => x.id === start.body.round.id)!;
    expect(start.body.round.hints).toEqual([...HUNT_HINTS]);
    const state = readHunt(start.body.token)!;
    const hint = hintFor(state, "type", "fr");
    if (!hint.ok) throw new Error(hint.error);
    expect(hint.body.cost).toBe(HUNT_HINT_COSTS.type);
    expect(hint.body.hint).toEqual({ kind: "type", types: e.types, names: expect.any(Array) });
    const pin = { x: e.places[0].pin[0], y: e.places[0].pin[1] };
    // With the hint's token: charged.
    const withHint = gradeHunt(readHunt(hint.body.token)!, { pins: [pin] });
    if (!withHint.ok) throw new Error(withHint.error);
    expect(withHint.body.score).toBe(5000 - HUNT_HINT_COSTS.type);
    expect(withHint.body.reveal).toMatchObject({ hints: ["type"], hintCost: HUNT_HINT_COSTS.type });
    // With the older token, the route hands over the hint its claim says was taken: charged all the same.
    const old = gradeHunt(state, { pins: [pin] }, Date.now(), ["type"]);
    if (!old.ok) throw new Error(old.error);
    expect(old.body.score).toBe(5000 - HUNT_HINT_COSTS.type);
    expect(huntHintKey(state, "type")).toBe(`${huntRoundKey(state)}:hint:type`);
  });

  it("answers each hint from the spots on the map played", () => {
    const spots = [{ methods: [{ method: "Cave", versions: ["diamond", "platinum"] }] }, { methods: [{ method: "Super Rod", versions: ["sword"] }, { method: "Grass", versions: ["shield"] }] }];
    expect(huntPlaceKindsOf(spots)).toEqual(["grass", "cave", "water"]);
    expect(huntGamesOf(spots)).toEqual(["Diamond / Platinum", "Sword / Shield"]);
    expect(huntPlaceKindsOf([{ methods: [{ method: "Wild" }] }])).toEqual([]);
  });

  it("offers no hints on Hard, which is always the world map", () => {
    const hard = startHunt({ mode: "classic", difficulty: "hard" });
    if (!hard.ok) throw new Error(hard.error);
    expect(hard.body.round.hints).toEqual([]);
    expect(hard.body.difficulty).toBe("hard");
    expect(hintFor(readHunt(hard.body.token)!, "type").ok).toBe(false);
    expect(startHunt({ mode: "region", region: "kanto", difficulty: "hard" }).ok).toBe(false);
  });

  it("deals famous Pokémon in their home region on Easy, on every map", () => {
    const easy = startHunt({ mode: "classic", difficulty: "easy" });
    if (!easy.ok) throw new Error(easy.error);
    const e = huntEntries().find((x) => x.id === easy.body.round.id)!;
    expect(e.famous && e.home).toBeTruthy();
    for (const region of HUNT_MAP_REGIONS) expect(startHunt({ mode: "region", region, difficulty: "easy" }).ok, region).toBe(true);
  });

  it("signs a first Daily for the board, never one played again", () => {
    const date = new Date().toISOString().slice(0, 10);
    const play = (repeat: boolean) => {
      const start = startHunt({ mode: "daily", date, repeat });
      if (!start.ok) throw new Error(start.error);
      let token = start.body.token;
      let last;
      for (let i = 0; i < HUNT_ROUNDS; i++) {
        const g = gradeHunt(readHunt(token)!, { pins: [{ x: 0.5, y: 0.5 }] });
        if (!g.ok) throw new Error(g.error);
        token = g.body.token;
        last = g.body;
      }
      return last!;
    };
    const first = play(false);
    const signed = readHuntResult(first.result?.resultToken);
    expect(signed).toMatchObject({ date, score: first.total, rounds: expect.any(Array) });
    expect(play(true).result?.resultToken).toBeUndefined();
    expect(readHuntResult("nope")).toBeNull();
  });

  it("grades a round once, and a far pin scores little", () => {
    const start = startHunt({ mode: "classic" });
    if (!start.ok) throw new Error(start.error);
    const state = readHunt(start.body.token)!;
    const g = gradeHunt(state, { pins: [{ x: 0.001, y: 0.999 }] });
    if (!g.ok) throw new Error(g.error);
    expect(g.body.score).toBeLessThan(500);
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

  it("plays every region map, with only that map's own spots in the reveal", () => {
    const crops = (geo as unknown as { world: { crops: Record<string, { regions: string[] }> } }).world.crops;
    for (const region of HUNT_MAP_REGIONS) {
      const start = startHunt({ mode: "region", region });
      if (!start.ok) throw new Error(`${region}: ${start.error}`);
      const g = gradeHunt(readHunt(start.body.token)!, { pins: [{ x: 0.5, y: 0.5 }] });
      if (!g.ok) throw new Error(g.error);
      const e = huntEntries().find((x) => x.id === start.body.round.id)!;
      const own = e.places.filter((p) => p.region === region && crops[region].regions.includes(p.geoRegion)).map((p) => p.name);
      expect(own.length).toBeGreaterThan(0);
      expect(g.body.reveal.spots.map((s) => s.name).sort()).toEqual(own.sort());
      for (const s of g.body.reveal.spots) {
        for (const v of s.pin) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("refuses an unknown region", () => {
    // @ts-expect-error: not a region with a map
    expect(startHunt({ mode: "region", region: "kitakami" }).ok).toBe(false);
  });
});
