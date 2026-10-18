import { describe, expect, it } from "vitest";
import { answerFor, geoRegions, gradeGeo, isGeoSpec, measureGuess, planRounds, readGeo, readGeoChallenge, startGeo } from "@/lib/server/geo";
import {
  GEO_KINDS,
  GEO_MAX_ROUND_SCORE,
  GEO_ROUNDS,
  GEO_STYLES,
  WORLD_DAILY_FROM,
  WORLD_REGION,
  geoBoardKey,
  geoDailyRegion,
  type GeoSpec,
} from "@/lib/geo-types";

const classic: GeoSpec = { region: "kanto", style: "classic", kind: "game" };
const retro: GeoSpec = { region: "kanto", style: "retro", kind: "game" };
const streak: GeoSpec = { region: "kanto", style: "classic", kind: "streak" };
const world: GeoSpec = { region: WORLD_REGION, style: "classic", kind: "game" };
const worldStreak: GeoSpec = { ...world, kind: "streak" };
/** The DLC areas count as their region (as in a world streak). */
const group = (region?: string) => ({ "Isle of Armor": "Galar", "Crown Tundra": "Galar", "Blueberry Academy": "Unova" })[region ?? ""] ?? region;

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
  it("has Kanto with enough places in both styles", () => {
    const [kanto] = geoRegions();
    expect(kanto.id).toBe("kanto");
    expect(kanto.locations.classic).toBeGreaterThanOrEqual(40);
    expect(kanto.locations.retro).toBeGreaterThanOrEqual(35);
    expect(isGeoSpec(classic)).toBe(true);
    expect(isGeoSpec({ ...classic, region: "orre" })).toBe(false);
  });

  it("has the world map and a map for every mainline region", () => {
    const regions = geoRegions();
    const ids = regions.map((r) => r.id);
    for (const id of [WORLD_REGION, "kanto", "johto", "hoenn", "sinnoh", "unova", "kalos", "alola", "galar", "paldea"]) {
      expect(ids).toContain(id);
      const region = regions.find((r) => r.id === id)!;
      expect(GEO_STYLES.some((style) => isGeoSpec({ region: id, style, kind: "game" })), id).toBe(true);
      expect(region.map.pixelArt).toBe(id === "kanto");
    }
    const w = regions.find((r) => r.id === WORLD_REGION)!;
    expect(w.locations.classic).toBeGreaterThanOrEqual(150);
    expect(w.locations.retro).toBeGreaterThanOrEqual(150);
    expect(w.map.markers!.length).toBeGreaterThan(100);
    // Every board key fits the leaderboard's mode column.
    for (const r of regions) for (const style of GEO_STYLES) for (const kind of GEO_KINDS) expect(geoBoardKey({ region: r.id, style, kind }).length).toBeLessThanOrEqual(40);
  });

  it("a five-round world game visits five different regions", () => {
    for (let i = 0; i < 20; i++) {
      for (const spec of [world, { ...world, style: "retro" as const }]) {
        const answers = planRounds(spec, `w${i}`).map((r) => answerFor(spec, r));
        expect(answers).toHaveLength(GEO_ROUNDS);
        expect(new Set(answers.map((a) => group(a.region))).size).toBe(GEO_ROUNDS);
        for (const a of answers) for (const v of a.pin) expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("scores places on a region's own map, cut from the world map", () => {
    for (const region of ["johto", "galar", "paldea"]) {
      const style = isGeoSpec({ region, style: "classic", kind: "game" }) ? "classic" : "retro";
      const spec: GeoSpec = { region, style, kind: "game" };
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

  it("plans five rounds in five different areas, deterministically, in the chosen style", () => {
    const a = planRounds(classic, "seed-1");
    expect(a).toHaveLength(GEO_ROUNDS);
    expect(planRounds(classic, "seed-1")).toEqual(a);
    expect(planRounds(classic, "seed-2")).not.toEqual(a);
    for (let i = 0; i < 20; i++) {
      const rounds = planRounds(classic, `c${i}`);
      const areas = rounds.map((r) => answerFor(classic, r)).map((x) => x.parent ?? x.name);
      expect(new Set(areas).size).toBe(GEO_ROUNDS);
      for (const r of rounds) expect(answerFor(classic, r).game).toMatch(/^Let's Go/);
      for (const r of planRounds(retro, `r${i}`)) expect(answerFor(retro, r).game).not.toMatch(/^Let's Go/);
    }
  });

  it("scores the true pin perfectly and falls off with distance", () => {
    const [round] = planRounds(classic, "score-test");
    const { pin } = answerFor(classic, round);
    const exact = measureGuess(classic, round, pin[0], pin[1]);
    expect(exact).toEqual({ score: GEO_MAX_ROUND_SCORE, hit: true, squares: 0 });
    const near = measureGuess(classic, round, Math.min(1, pin[0] + 0.08), pin[1]);
    const far = measureGuess(classic, round, pin[0] > 0.5 ? 0 : 1, pin[1] > 0.5 ? 0 : 1);
    expect(near.score).toBeLessThan(GEO_MAX_ROUND_SCORE);
    expect(far.score).toBeLessThan(near.score);
    expect(far.squares).toBeGreaterThan(near.squares);
    expect(far.hit).toBe(false);
  });

  it("plays a full game through signed tokens and never leaks answers early", () => {
    const { start, bodies, state } = playOut(classic, { x: 0.5, y: 0.5 });
    expect(JSON.stringify(start)).not.toMatch(/pin|mask|name|Route|City|Town/);
    expect(bodies).toHaveLength(GEO_ROUNDS);
    for (const b of bodies) if (b.next) expect(JSON.stringify(b.next)).not.toMatch(/pin|mask|name/);
    expect(bodies.at(-1)!.total).toBe(bodies.reduce((s, b) => s + b.score, 0));
    expect(gradeGeo(state, { x: 0.5, y: 0.5 }).ok).toBe(false);
    expect(readGeo(start.token.slice(0, -2) + (start.token.endsWith("AA") ? "BB" : "AA"))).toBeNull();
  });

  it("gives everyone the same daily game", () => {
    const a = startGeo({ ...classic, daily: "2026-10-18" });
    const b = startGeo({ ...classic, daily: "2026-10-18" });
    expect(a.round).toEqual(b.round);
  });

  it("challenge links replay the same five places and carry the friend's score", () => {
    const { bodies } = playOut(classic, { x: 0.4, y: 0.6 }, { name: "Misty" });
    const last = bodies.at(-1)!;
    expect(last.challengeToken).toBeTruthy();
    const challenge = readGeoChallenge(last.challengeToken)!;
    expect(challenge).toMatchObject({ name: "Misty", score: last.total, style: "classic", region: "kanto" });
    expect(challenge.rounds).toEqual(bodies.map((b) => b.score));
    const replay = startGeo({ ...classic, practice: "challenge" }, { seed: challenge.seed });
    expect(replay.round.shot).toBe(startGeo(classic, { seed: challenge.seed }).round.shot);
    expect(readGeoChallenge("forged.token")).toBeNull();
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
