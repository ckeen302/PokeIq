import { describe, expect, it } from "vitest";
import { answerFor, geoRegions, gradeGeo, isGeoSpec, measureGuess, planRounds, readGeo, readGeoChallenge, startGeo } from "@/lib/server/geo";
import { signToken } from "@/lib/server/crypto";
import {
  GEO_KINDS,
  GEO_MAX_ROUND_SCORE,
  GEO_ROUNDS,
  WORLD_DAILY_FROM,
  WORLD_REGION,
  geoBoardKey,
  geoDailyRegion,
  type GeoSpec,
} from "@/lib/geo-types";

const kanto: GeoSpec = { region: "kanto", kind: "game" };
const streak: GeoSpec = { region: "kanto", kind: "streak" };
const world: GeoSpec = { region: WORLD_REGION, kind: "game" };
const worldStreak: GeoSpec = { ...world, kind: "streak" };
/** The DLC areas and the Sevii Islands count as their region (as in a world streak). */
const group = (region?: string) =>
  ({ "Isle of Armor": "Galar", "Crown Tundra": "Galar", "Blueberry Academy": "Unova", "Sevii Islands": "Kanto" })[region ?? ""] ?? region;
/** A round's town or route (a building shares its town's). */
const areaKey = (spec: GeoSpec, round: Parameters<typeof answerFor>[1]) => {
  const a = answerFor(spec, round);
  return `${a.region}|${a.parent ?? a.name}`;
};

/** Plays a game to the end, pinning every round at (x, y) or on the true pin. */
function playOut(spec: GeoSpec, at: "pin" | { x: number; y: number }, opts?: Parameters<typeof startGeo>[1]) {
  const start = startGeo(spec, opts);
  let state = readGeo(start.token)!;
  const rounds = planRounds(spec, state.seed);
  const bodies = [];
  for (let i = 0; ; i++) {
    const pin = at === "pin" ? answerFor(spec, rounds[i]).pin : null;
    const outcome = gradeGeo(state, pin ? { x: pin[0], y: pin[1] } : (at as { x: number; y: number }));
    if (!outcome.ok) throw new Error(outcome.error);
    bodies.push(outcome.body);
    if (outcome.body.done) return { start, bodies, state: readGeo(outcome.body.token)! };
    state = readGeo(outcome.body.token)!;
  }
}

describe("PokéGuessr", () => {
  it("has Kanto with every place and every game it's in", () => {
    const info = geoRegions().find((r) => r.id === "kanto")!;
    expect(info.locations).toBeGreaterThanOrEqual(45);
    for (const game of ["Red / Blue / Yellow", "Gold / Silver / Crystal", "FireRed / LeafGreen", "HeartGold / SoulSilver", "Let's Go, Pikachu! / Eevee!"]) {
      expect(info.games).toContain(game);
    }
    expect(info.games[0]).toBe("Red / Blue / Yellow");
    expect(isGeoSpec(kanto)).toBe(true);
    expect(isGeoSpec({ ...kanto, region: "orre" })).toBe(false);
  });

  it("plays every map on the world atlas: the whole world and each mainline region's part of it", () => {
    const regions = geoRegions();
    const ids = regions.map((r) => r.id);
    const w = regions.find((r) => r.id === WORLD_REGION)!;
    const [, , worldW, worldH] = w.map.box;
    expect(w.map.box.slice(0, 2)).toEqual([0, 0]);
    for (const id of [WORLD_REGION, "kanto", "johto", "hoenn", "sinnoh", "unova", "kalos", "alola", "galar", "paldea"]) {
      expect(ids).toContain(id);
      const [x0, y0, x1, y1] = regions.find((r) => r.id === id)!.map.box;
      expect(isGeoSpec({ region: id, kind: "game" }), id).toBe(true);
      expect(x0 >= 0 && y0 >= 0 && x1 <= worldW && y1 <= worldH && x0 < x1 && y0 < y1, id).toBe(true);
    }
    expect(w.locations).toBeGreaterThanOrEqual(600);
    // Every board key fits the leaderboard's mode column.
    for (const r of regions) for (const kind of GEO_KINDS) expect(geoBoardKey({ region: r.id, kind }).length).toBeLessThanOrEqual(40);
  });

  it("a five-round world game visits five different regions", () => {
    for (let i = 0; i < 40; i++) {
      const answers = planRounds(world, `w${i}`).map((r) => answerFor(world, r));
      expect(answers).toHaveLength(GEO_ROUNDS);
      expect(new Set(answers.map((a) => group(a.region))).size).toBe(GEO_ROUNDS);
      for (const a of answers) for (const v of a.pin) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives every place in the world a fair chance, not just the small regions'", () => {
    const games = 3000;
    const seen = new Map<string, number>();
    const regions = new Set<string>();
    for (let i = 0; i < games; i++) {
      for (const r of planRounds(world, `fair${i}`)) {
        const key = areaKey(world, r);
        seen.set(key, (seen.get(key) ?? 0) + 1);
        regions.add(group(answerFor(world, r).region)!);
      }
    }
    expect(regions.size).toBeGreaterThanOrEqual(10);
    // Most of the world's places come up in a few thousand games, and none hogs them.
    expect(seen.size).toBeGreaterThan(geoRegions().find((r) => r.id === WORLD_REGION)!.locations * 0.95);
    expect(Math.max(...seen.values()) / games).toBeLessThan(0.025);
  });

  it("scores places on a region's own map, cut from the world map", () => {
    for (const region of ["johto", "galar", "paldea"]) {
      const spec: GeoSpec = { region, kind: "game" };
      for (const round of planRounds(spec, `crop-${region}`)) {
        const { pin, region: place } = answerFor(spec, round);
        for (const v of pin) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
        expect(measureGuess(spec, round, pin[0], pin[1]).score).toBe(GEO_MAX_ROUND_SCORE);
        expect(group(place)).toBe(region === "johto" ? "Johto" : region === "galar" ? "Galar" : "Paldea");
      }
    }
  });

  it("a world streak only needs the right region", () => {
    const rounds = planRounds(worldStreak, "world-streak");
    const answers = rounds.map((r) => answerFor(worldStreak, r));
    const [first] = answers;
    const sameRegion = answers.find((a, i) => i > 0 && !a.parent && group(a.region) === group(first.region) && a.name !== first.name)!;
    const elsewhere = answers.find((a) => !a.parent && group(a.region) !== group(first.region))!;
    const near = measureGuess(worldStreak, rounds[0], sameRegion.pin[0], sameRegion.pin[1]);
    expect(near.hit).toBe(true);
    expect(near.score).toBeLessThan(GEO_MAX_ROUND_SCORE);
    expect(measureGuess(worldStreak, rounds[0], elsewhere.pin[0], elsewhere.pin[1]).hit).toBe(false);
    expect(measureGuess(worldStreak, rounds[0], first.pin[0], first.pin[1])).toMatchObject({ score: GEO_MAX_ROUND_SCORE, hit: true, squares: 0 });
  });

  it("moves the daily game to the world map", () => {
    expect(geoDailyRegion("2026-10-01", true)).toBe("kanto");
    expect(geoDailyRegion(WORLD_DAILY_FROM, true)).toBe(WORLD_REGION);
    expect(geoDailyRegion(WORLD_DAILY_FROM, false)).toBe("kanto");
  });

  it("plans five rounds in five different areas, deterministically, from every game", () => {
    const a = planRounds(kanto, "seed-1");
    expect(a).toHaveLength(GEO_ROUNDS);
    expect(planRounds(kanto, "seed-1")).toEqual(a);
    expect(planRounds(kanto, "seed-2")).not.toEqual(a);
    const games = new Map<string, number>();
    for (let i = 0; i < 200; i++) {
      const rounds = planRounds(kanto, `c${i}`);
      expect(new Set(rounds.map((r) => areaKey(kanto, r))).size).toBe(GEO_ROUNDS);
      for (const r of rounds) games.set(answerFor(kanto, r).game, (games.get(answerFor(kanto, r).game) ?? 0) + 1);
    }
    // The originals and every remake, each a fair share of the rounds.
    for (const game of ["Red / Blue / Yellow", "Gold / Silver / Crystal", "FireRed / LeafGreen", "HeartGold / SoulSilver", "Let's Go, Pikachu! / Eevee!"]) {
      expect(games.get(game) ?? 0, game).toBeGreaterThan(200 * GEO_ROUNDS * 0.08);
    }
  });

  it("keeps a player's recent places from coming straight back", () => {
    const run = (steer: boolean) => {
      let recent: string[] = [];
      let repeats = 0;
      for (let i = 0; i < 12; i++) {
        const state = readGeo(startGeo(kanto, { recent: steer ? recent : undefined }).token)!;
        const areas = planRounds(kanto, state.seed).map((r) => areaKey(kanto, r));
        repeats += areas.filter((k) => recent.slice(0, 20).includes(k)).length;
        recent = [...areas.reverse(), ...recent];
      }
      return repeats;
    };
    // Twelve games in a row of Kanto's ~50 places: without steering, about two places a game are from the last four games.
    expect(run(true)).toBeLessThanOrEqual(4);
    expect(run(false)).toBeGreaterThan(run(true));
  });

  it("scores the true pin perfectly and falls off with distance", () => {
    const [round] = planRounds(kanto, "score-test");
    const { pin, mask } = answerFor(kanto, round);
    const exact = measureGuess(kanto, round, pin[0], pin[1]);
    expect(exact).toEqual({ score: GEO_MAX_ROUND_SCORE, hit: true, squares: 0 });
    // A little way past the edge of the place's area.
    const right = Math.max(...mask.map(([x]) => x));
    const left = Math.min(...mask.map(([x]) => x));
    const near = measureGuess(kanto, round, right < 0.9 ? right + 0.06 : left - 0.06, pin[1]);
    const far = measureGuess(kanto, round, pin[0] > 0.5 ? 0 : 1, pin[1] > 0.5 ? 0 : 1);
    expect(near.score).toBeLessThan(GEO_MAX_ROUND_SCORE);
    expect(far.score).toBeLessThan(near.score);
    expect(far.squares).toBeGreaterThan(near.squares);
    expect(far.hit).toBe(false);
  });

  it("plays a full game through signed tokens and never leaks answers early", () => {
    const { start, bodies, state } = playOut(kanto, { x: 0.5, y: 0.5 });
    expect(JSON.stringify(start)).not.toMatch(/pin|mask|name|Route|City|Town/);
    expect(bodies).toHaveLength(GEO_ROUNDS);
    for (const b of bodies) if (b.next) expect(JSON.stringify(b.next)).not.toMatch(/pin|mask|name/);
    expect(bodies.at(-1)!.total).toBe(bodies.reduce((s, b) => s + b.score, 0));
    expect(gradeGeo(state, { x: 0.5, y: 0.5 }).ok).toBe(false);
    expect(readGeo(start.token.slice(0, -2) + (start.token.endsWith("AA") ? "BB" : "AA"))).toBeNull();
  });

  it("a game in progress keeps its rounds through an update", () => {
    // The token carries its rounds, sealed: change what the seed would plan, and the game plays on as it started.
    const start = startGeo(kanto, { seed: "planned" });
    const state = readGeo(start.token)!;
    expect(start.token).not.toMatch(/Route|City|Town|Kanto/);
    const moved = { ...state, seed: "something-else" };
    const [first] = planRounds(kanto, "planned");
    const outcome = gradeGeo(readGeo(signToken("geo", moved))!, { x: 0.5, y: 0.5 });
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.body.answer.name).toBe(answerFor(kanto, first).name);
    expect(outcome.body.next!.shot).toBe(`/api/geo/shot/${planRounds(kanto, "planned")[1].shot}`);
  });

  it("gives everyone the same daily game", () => {
    const a = startGeo({ ...kanto, daily: "2026-10-18" });
    const b = startGeo({ ...kanto, daily: "2026-10-18" }, { recent: ["Kanto|Pallet Town"] });
    expect(a.round).toEqual(b.round);
  });

  it("challenge links replay the same five places and carry the friend's score", () => {
    const { bodies } = playOut(kanto, { x: 0.4, y: 0.6 }, { name: "Misty" });
    const last = bodies.at(-1)!;
    expect(last.challengeToken).toBeTruthy();
    const challenge = readGeoChallenge(last.challengeToken)!;
    expect(challenge).toMatchObject({ name: "Misty", score: last.total, region: "kanto" });
    expect(challenge.rounds).toEqual(bodies.map((b) => b.score));
    const replay = startGeo({ ...kanto, practice: "challenge" }, { seed: challenge.seed, recent: ["Kanto|Pallet Town"] });
    expect(replay.round.shot).toBe(startGeo(kanto, { seed: challenge.seed }).round.shot);
    expect(readGeoChallenge("forged.token")).toBeNull();
    // Links from before every game was one pool would now plan other places.
    expect(readGeoChallenge(signToken("geo-challenge", { s: "x", r: "kanto", y: "classic", n: "", t: 1, p: [1] }))).toBeNull();
  });

  it("scores a guess on any place's flag perfectly", () => {
    // A world streak visits every place on the map.
    const rounds = planRounds(worldStreak, "every-flag");
    expect(rounds.length).toBeGreaterThan(600);
    for (const round of rounds) {
      const { pin, name } = answerFor(worldStreak, round);
      expect(measureGuess(worldStreak, round, pin[0], pin[1]).score, name).toBe(GEO_MAX_ROUND_SCORE);
    }
  });

  it("never counts a corner of the map as part of a place", () => {
    for (const spec of [streak, worldStreak]) {
      for (const round of planRounds(spec, "corners")) {
        for (const [x, y] of answerFor(spec, round).mask) expect(Math.min(x, 1 - x) < 0.01 && Math.min(y, 1 - y) < 0.01).toBe(false);
      }
    }
  });

  it("streaks continue on every hit and end on the first miss", () => {
    const perfect = playOut(streak, "pin");
    expect(perfect.bodies.every((b) => b.hit)).toBe(true);
    expect(perfect.bodies.at(-1)!.result!.score).toBe(perfect.bodies.length);
    expect(perfect.bodies.length).toBeGreaterThan(GEO_ROUNDS);

    const start = startGeo(streak);
    const state = readGeo(start.token)!;
    const [first] = planRounds(streak, state.seed);
    const { pin } = answerFor(streak, first);
    const miss = gradeGeo(state, { x: pin[0] > 0.5 ? 0 : 1, y: pin[1] > 0.5 ? 0 : 1 });
    if (!miss.ok) throw new Error(miss.error);
    expect(miss.body).toMatchObject({ hit: false, done: true });
    expect(miss.body.result!.score).toBe(0);
    expect(miss.body.challengeToken).toBeUndefined();
  });
});

describe("PokéGuessr game filters", () => {
  const familyOf = (spec: GeoSpec, round: Parameters<typeof answerFor>[1]) => answerFor(spec, round).family;

  it("deals only an era's screenshots, from every place that has them", () => {
    const classic: GeoSpec = { region: WORLD_REGION, kind: "streak", era: "2d" };
    const modern: GeoSpec = { region: WORLD_REGION, kind: "streak", era: "3d" };
    const twoD = new Set(["rby", "gsc", "rse", "frlg", "dppt", "hgss", "bw"]);
    const c = planRounds(classic, "era-2d");
    const m = planRounds(modern, "era-3d");
    expect(c.length).toBeGreaterThan(300);
    expect(m.length).toBeGreaterThan(300);
    for (const r of c) expect(twoD.has(familyOf(classic, r))).toBe(true);
    for (const r of m) expect(twoD.has(familyOf(modern, r))).toBe(false);
    // A five-round world game on an era still visits five regions.
    const answers = planRounds({ ...classic, kind: "game" }, "era-world").map((r) => answerFor(classic, r));
    expect(new Set(answers.map((a) => group(a.region))).size).toBe(GEO_ROUNDS);
  });

  it("deals only picked families, and turns off a map with too few places for them", () => {
    const picked: GeoSpec = { region: "kanto", kind: "game", families: ["frlg", "lgpe"] };
    for (let i = 0; i < 30; i++) for (const r of planRounds(picked, `pick-${i}`)) expect(["frlg", "lgpe"]).toContain(familyOf(picked, r));
    expect(isGeoSpec(picked)).toBe(true);
    // Kalos and Paldea have no sprite games.
    expect(isGeoSpec({ region: "kalos", kind: "game", era: "2d" })).toBe(false);
    expect(isGeoSpec({ region: "paldea", kind: "streak", era: "2d" })).toBe(false);
    expect(isGeoSpec({ region: "kanto", kind: "game", families: ["za"] })).toBe(false);
    const kalos = geoRegions().find((r) => r.id === "kalos")!;
    expect(kalos.families.every((f) => ["xy", "za"].includes(f))).toBe(true);
    expect(Object.values(kalos.combos).reduce((a, b) => a + b, 0)).toBe(kalos.locations);
  });

  it("gives Classic 2D and Modern 3D boards of their own", () => {
    expect(geoBoardKey({ region: WORLD_REGION, kind: "game" })).toBe("world");
    expect(geoBoardKey({ region: WORLD_REGION, kind: "game", era: "2d" })).toBe("world:2d");
    expect(geoBoardKey({ region: "kanto", kind: "streak", era: "3d" })).toBe("kanto:3d:streak");
    for (const r of geoRegions()) for (const kind of GEO_KINDS) expect(geoBoardKey({ region: r.id, kind, era: "3d" }).length).toBeLessThanOrEqual(40);
  });

  it("adds a bonus for naming the game, kept apart from the ranked score", () => {
    const spec: GeoSpec = { region: "kanto", kind: "game", guessGame: true };
    const start = startGeo(spec);
    let state = readGeo(start.token)!;
    const rounds = planRounds(spec, state.seed);
    let last;
    for (let i = 0; i < GEO_ROUNDS; i++) {
      const answer = answerFor(spec, rounds[i]);
      // The right game on even rounds, a wrong one on odd rounds.
      const family = i % 2 === 0 ? answer.family : answer.family === "rby" ? "gsc" : "rby";
      const out = gradeGeo(state, { x: answer.pin[0], y: answer.pin[1], family });
      if (!out.ok) throw new Error(out.error);
      expect(out.body.gameGuess).toMatchObject({ correct: i % 2 === 0, bonus: i % 2 === 0 ? 1000 : 0 });
      last = out.body;
      state = readGeo(out.body.token)!;
    }
    expect(last!.result!.score).toBe(GEO_ROUNDS * GEO_MAX_ROUND_SCORE);
    expect(last!.result!.bonus).toBe(3000);
    expect(last!.bonusTotal).toBe(3000);
    // Without the option: no bonus fields at all (scored as before).
    const plain = playOut(kanto, "pin");
    expect(plain.bodies.at(-1)!.result!.bonus).toBeUndefined();
    expect(plain.bodies.at(-1)!.gameGuess).toBeUndefined();
  });

  it("carries a challenge's filter so the friend plays the same games", () => {
    expect(isGeoSpec({ region: "johto", kind: "game", era: "3d" })).toBe(false);
    const spec: GeoSpec = { region: "sinnoh", kind: "game", era: "3d" };
    expect(isGeoSpec(spec)).toBe(true);
    const { bodies } = playOut(spec, { x: 0.5, y: 0.5 });
    expect(readGeoChallenge(bodies.at(-1)!.challengeToken)!.era).toBe("3d");
  });
});
