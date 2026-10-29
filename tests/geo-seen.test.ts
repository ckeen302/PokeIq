import { describe, expect, it } from "vitest";
import { answerFor, gradeGeo, planRounds, readGeo, roundsOf, seenShotsOf, startGeo } from "@/lib/server/geo";
import { GEO_SEEN_MAX, readSeenShots, rememberSeenShot, shotIdOf } from "@/lib/geo-seen";
import geo from "@/data/geo.json";
import geoRetired from "@/data/geo-retired.json";
import { GEO_ROUNDS, type GeoSpec } from "@/lib/geo-types";

/**
 * No-repeat: the screenshots a player has already been dealt (kept on their
 * device, sent when a game starts) come up last: unseen ones first, then the
 * least recently seen when a map's pool is small.
 */

type Loc = { name: string; region: string; parent?: string; shots: { id: string }[] };
const LOCS = (geo as unknown as { world: { locations: Loc[] } }).world.locations;
const RETIRED = new Set(geoRetired as string[]);
const kanto: GeoSpec = { region: "kanto", kind: "game" };
const streak: GeoSpec = { region: "kanto", kind: "streak" };
const areaOf = (l: Loc) => `${l.region}|${l.parent ?? l.name}`;
/** Kanto's areas (a town or route with its buildings) and every dealable shot in each. */
const KANTO = (() => {
  const by = new Map<string, string[]>();
  for (const l of LOCS) {
    if (l.region !== "Kanto") continue;
    const ids = l.shots.map((s) => s.id).filter((id) => !RETIRED.has(id));
    if (ids.length) by.set(areaOf(l), [...(by.get(areaOf(l)) ?? []), ...ids]);
  }
  return by;
})();
const idOf = (shot: string) => shotIdOf(shot)!;
const dealt = (spec: GeoSpec, token: string) =>
  roundsOf(readGeo(token)!).map((r) => ({ id: r.shot, area: `${answerFor(spec, r).region}|${answerFor(spec, r).parent ?? answerFor(spec, r).name}` }));

describe("PokéGuessr no-repeat", () => {
  it("deals screenshots the player hasn't seen before any they have", () => {
    const areas = [...KANTO.keys()];
    expect(areas.length).toBeGreaterThan(40);
    // Everything but six areas has been seen.
    const fresh = new Set(areas.slice(-6));
    const seen = areas.filter((a) => !fresh.has(a)).flatMap((a) => KANTO.get(a)!);
    for (let i = 0; i < 20; i++) {
      const start = startGeo(kanto, { seen });
      expect(idOf(start.round.shot)).not.toBe(undefined);
      const rounds = dealt(kanto, start.token);
      expect(rounds).toHaveLength(GEO_ROUNDS);
      for (const r of rounds) {
        expect(seen).not.toContain(r.id);
        expect(fresh.has(r.area), r.area).toBe(true);
      }
      expect(new Set(rounds.map((r) => r.area)).size).toBe(GEO_ROUNDS);
    }
  });

  it("falls back to the least recently seen when the whole pool has been seen", () => {
    // Every Kanto shot seen, most recent first.
    const seen = [...KANTO.values()].flat();
    const rank = new Map(seen.map((id, i) => [id, i]));
    for (let i = 0; i < 10; i++) {
      const rounds = dealt(kanto, startGeo(kanto, { seen }).token);
      // The dealt shots are from the older half of the list, never the ones just seen.
      for (const r of rounds) expect(rank.get(r.id)!, r.id).toBeGreaterThan(seen.length * 0.5);
    }
    // Reverse the recency, and the other end of the list comes up.
    const flipped = [...seen].reverse();
    const rounds = dealt(kanto, startGeo(kanto, { seen: flipped }).token);
    for (const r of rounds) expect(rank.get(r.id)!, r.id).toBeLessThan(seen.length * 0.5);
  });

  it("keeps the unseen-first order through a streak, where rounds are planned again on every guess", () => {
    const areas = [...KANTO.keys()];
    const fresh = new Set(areas.slice(0, 8));
    const seen = areas.filter((a) => !fresh.has(a)).flatMap((a) => KANTO.get(a)!);
    const start = startGeo(streak, { seen });
    let state = readGeo(start.token)!;
    expect(state.seen).toBeTruthy();
    const played: { id: string; area: string }[] = [];
    let shot = start.round.shot;
    for (let i = 0; i < 20; i++) {
      const rounds = planRounds(streak, state.seed, Infinity, seenShotsOf(state));
      const round = rounds[i];
      expect(`/api/geo/shot/${round.shot}`).toBe(shot);
      const a = answerFor(streak, round);
      played.push({ id: round.shot, area: `${a.region}|${a.parent ?? a.name}` });
      const out = gradeGeo(state, { x: a.pin[0], y: a.pin[1] });
      if (!out.ok) throw new Error(out.error);
      expect(out.body.hit).toBe(true);
      state = readGeo(out.body.token)!;
      shot = out.body.next!.shot;
    }
    // The eight unseen areas first, then the seen ones; no area twice.
    expect(played.slice(0, 8).every((p) => fresh.has(p.area))).toBe(true);
    expect(played.slice(0, 8).every((p) => !seen.includes(p.id))).toBe(true);
    expect(new Set(played.map((p) => p.area)).size).toBe(played.length);
    // The seen list isn't in the token in the clear, and a game (sealed plan) needs none.
    expect(start.token).not.toContain(seen[0]);
    expect(readGeo(startGeo(kanto, { seen }).token)!.seen).toBeUndefined();
  });

  it("applies to a small filtered pool too, unseen first then the oldest", () => {
    const spec: GeoSpec = { region: "kanto", kind: "game", families: ["lgpe"], practice: "filtered" };
    const pool = planRounds({ ...spec, kind: "streak" }, "lgpe-pool").map((r) => r.shot);
    expect(pool.length).toBeGreaterThanOrEqual(10);
    const seen = pool.slice(0, pool.length - 2);
    const rounds = dealt(spec, startGeo(spec, { seen }).token);
    const unseen = rounds.filter((r) => !seen.includes(r.id));
    expect(unseen.length).toBeGreaterThanOrEqual(2);
    for (const r of rounds) if (seen.includes(r.id)) expect(seen.indexOf(r.id)).toBeGreaterThan(seen.length * 0.3);
  });

  it("leaves the daily (the same for everyone) and a friend's challenge alone", () => {
    const daily: GeoSpec = { ...kanto, daily: "2026-10-20" };
    const seen = [...KANTO.values()].flat();
    expect(startGeo(daily, { seen }).round).toEqual(startGeo(daily).round);
    expect(startGeo({ ...kanto, practice: "challenge" }, { seed: "friend", seen }).round).toEqual(startGeo(kanto, { seed: "friend" }).round);
    // Unknown ids are ignored.
    expect(dealt(kanto, startGeo(kanto, { seen: ["nope", "../x", ""] }).token)).toHaveLength(GEO_ROUNDS);
  });

  it("the device keeps the list, most recent first, capped", () => {
    const store = new Map<string, string>();
    const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const g = globalThis as unknown as { localStorage?: unknown };
    const had = g.localStorage;
    g.localStorage = fake;
    try {
      expect(readSeenShots()).toEqual([]);
      expect(shotIdOf("/api/geo/shot/abcdEFGH1234")).toBe("abcdEFGH1234");
      expect(shotIdOf("/api/geo/preview/abcdEFGH1234")).toBeNull();
      expect(shotIdOf("https://example.com/x")).toBeNull();
      rememberSeenShot("/api/geo/shot/abcdEFGH1234");
      rememberSeenShot("/api/geo/shot/abcdEFGH5678");
      rememberSeenShot("/api/geo/shot/abcdEFGH1234");
      rememberSeenShot("/api/geo/preview/ignored12");
      expect(readSeenShots()).toEqual(["abcdEFGH1234", "abcdEFGH5678"]);
      for (let i = 0; i < GEO_SEEN_MAX + 20; i++) rememberSeenShot(`/api/geo/shot/shot${String(i).padStart(8, "0")}`);
      expect(readSeenShots()).toHaveLength(GEO_SEEN_MAX);
      expect(readSeenShots()[0]).toBe(`shot${String(GEO_SEEN_MAX + 19).padStart(8, "0")}`);
    } finally {
      g.localStorage = had;
    }
  });
});
