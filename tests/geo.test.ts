import { describe, expect, it } from "vitest";
import { answerFor, geoRegions, gradeGeo, isGeoSpec, planRounds, readGeo, scoreGuess, startGeo } from "@/lib/server/geo";
import { GEO_MAX_ROUND_SCORE, GEO_ROUNDS, type GeoSpec } from "@/lib/geo-types";

const classic: GeoSpec = { region: "kanto", style: "classic" };
const retro: GeoSpec = { region: "kanto", style: "retro" };

describe("PokéGuessr", () => {
  it("has Kanto with enough places in both styles", () => {
    const [kanto] = geoRegions();
    expect(kanto.id).toBe("kanto");
    expect(kanto.locations.classic).toBeGreaterThanOrEqual(40);
    expect(kanto.locations.retro).toBeGreaterThanOrEqual(35);
    expect(isGeoSpec(classic)).toBe(true);
    expect(isGeoSpec({ region: "galar", style: "classic" })).toBe(false);
  });

  it("plans five distinct rounds deterministically, in the chosen style", () => {
    const a = planRounds(classic, "seed-1");
    expect(a).toHaveLength(GEO_ROUNDS);
    expect(new Set(a.map((r) => r.location)).size).toBe(GEO_ROUNDS);
    expect(planRounds(classic, "seed-1")).toEqual(a);
    expect(planRounds(classic, "seed-2")).not.toEqual(a);
    for (let i = 0; i < 20; i++) {
      for (const r of planRounds(classic, `c${i}`)) expect(answerFor(classic, r).game).toMatch(/^Let's Go/);
      for (const r of planRounds(retro, `r${i}`)) expect(answerFor(retro, r).game).not.toMatch(/^Let's Go/);
    }
  });

  it("scores the true pin perfectly and falls off with distance", () => {
    const [round] = planRounds(classic, "score-test");
    const { pin } = answerFor(classic, round);
    expect(scoreGuess(classic, round, pin[0], pin[1])).toBe(GEO_MAX_ROUND_SCORE);
    const near = scoreGuess(classic, round, Math.min(1, pin[0] + 0.08), pin[1]);
    const far = scoreGuess(classic, round, pin[0] > 0.5 ? 0 : 1, pin[1] > 0.5 ? 0 : 1);
    expect(near).toBeLessThan(GEO_MAX_ROUND_SCORE);
    expect(far).toBeLessThan(near);
    expect(far).toBeGreaterThanOrEqual(0);
  });

  it("plays a full game through signed tokens and never leaks answers early", () => {
    const start = startGeo(classic);
    expect(JSON.stringify(start)).not.toMatch(/pin|mask|name|Route|City|Town/);
    let state = readGeo(start.token)!;
    let total = 0;
    for (let i = 0; i < GEO_ROUNDS; i++) {
      const outcome = gradeGeo(state, { x: 0.5, y: 0.5 });
      if (!outcome.ok) throw new Error(outcome.error);
      total += outcome.body.score;
      expect(outcome.body.total).toBe(total);
      if (outcome.body.next) expect(JSON.stringify(outcome.body.next)).not.toMatch(/pin|mask|name/);
      state = readGeo(outcome.body.token)!;
    }
    expect(gradeGeo(state, { x: 0.5, y: 0.5 }).ok).toBe(false);
    expect(readGeo(start.token.slice(0, -2) + (start.token.endsWith("AA") ? "BB" : "AA"))).toBeNull();
  });

  it("gives everyone the same daily game", () => {
    const a = startGeo({ ...classic, daily: "2026-10-18" });
    const b = startGeo({ ...classic, daily: "2026-10-18" });
    expect(a.round).toEqual(b.round);
  });
});
