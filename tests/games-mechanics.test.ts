import { describe, expect, it } from "vitest";
import { referenceAthlete, TRAIT, type Athlete } from "@/lib/games/athlete";
import { FORM, HIGH_JUMP, JAVELIN, LIFT, LONG_JUMP, SHOT, SPRINT, SWIM, spring } from "@/lib/games/constants";
import { GAMES_ATHLETES, GAMES_BY_KEY } from "@/lib/games/data";
import { formatMark, formatSeconds } from "@/lib/games/events";
import { highJumpMark, highJumpPhysics, runHighJump } from "@/lib/games/highjump";
import { liftMark, loadBar, maxLift, runLift } from "@/lib/games/lift";
import { jumpPhysics, longJumpMark, runLongJump } from "@/lib/games/longjump";
import { formFactor, rngFor } from "@/lib/games/seed";
import { dipOf, meanReaction, officialTime, photoTime, runSprint, sprintEvent, sprintMark } from "@/lib/games/sprint";
import { aquatic, runSwim, simulateSwim, swimMark, swimSpeed } from "@/lib/games/swim";
import { javelinMark, loadFactor, runThrow, shotMark, throwPhysics } from "@/lib/games/throws";
import { bout, pushForce, runBracket } from "@/lib/games/wrestle";
import { runEvent } from "@/lib/games/games";
import { finishTime, runnerFor, topSpeed } from "@/lib/race/model";

const mon = (k: string): Athlete => {
  const a = GAMES_BY_KEY.get(k);
  if (!a) throw new Error(`no ${k}`);
  return a;
};
const within = (v: number, target: number, share = 0.03) => expect(Math.abs(v / target - 1), `${v} vs ${target}`).toBeLessThanOrEqual(share);
const ref = referenceAthlete();
const withStats = (a: Athlete, s: Partial<Athlete["stats"]>): Athlete => ({ ...a, stats: { ...a.stats, ...s }, entrant: { ...a.entrant, stats: { ...a.entrant.stats, ...s } } });

describe("anchors: the 70 kg, 1.8 m, base-100 reference lands an elite human mark (±3%)", () => {
  it("long jump: 8.4 m", () => within(longJumpMark(ref), LONG_JUMP.anchor));
  it("high jump: 2.35 m (and at 1.9 m tall, the anchor's height)", () => {
    within(highJumpMark(ref), HIGH_JUMP.anchor);
    within(highJumpMark(referenceAthlete({ height: HIGH_JUMP.anchorHeight })), HIGH_JUMP.anchor, 0.01);
  });
  it("shot put: 22 m", () => within(shotMark(ref), SHOT.anchor));
  it("javelin: about 88 m", () => within(javelinMark(ref), JAVELIN.anchor));
  it("weightlifting: 190 kg", () => expect(liftMark(ref)).toBe(LIFT.ref));
  it("swimming: 50 m in 21.3 s and 100 m in 47 s", () => {
    within(swimMark(ref, "50m-freestyle"), SWIM.anchor50);
    within(swimMark(ref, "100m-freestyle"), SWIM.anchor100);
  });
  it("running keeps the Race's convention: base 100 Speed is a 10 m/s top speed, and the time is the Race model's plus the reaction", () => {
    expect(topSpeed(ref.stats.spe)).toBe(10);
    const race = finishTime(runnerFor(ref.stats, ref.kg), 100 - dipOf(ref));
    expect(sprintMark(ref, "100m")).toBeCloseTo(race + meanReaction(100), 9);
    expect(meanReaction(100)).toBeCloseTo(0.135, 3);
  });
  it("muscle force scales with mass^(2/3): a 950 kg Groudon is strong, not 14 times stronger", () => {
    const g = mon("groudon");
    const perStat = maxLift({ kg: g.kg, stats: { ...g.stats, atk: 100, def: 100 } }) / LIFT.ref;
    expect(perStat).toBeCloseTo(Math.pow(950 / 70, 2 / 3), 6);
    expect(perStat).toBeLessThan(6);
  });
});

describe("monotonic: more Attack never throws, jumps or lifts less; more Speed never runs or swims slower", () => {
  const sample = GAMES_ATHLETES.filter((_, i) => i % 23 === 0);
  it("Attack", () => {
    for (const a of sample) {
      const up = withStats(a, { atk: a.stats.atk + 15 });
      expect(shotMark(up)).toBeGreaterThanOrEqual(shotMark(a));
      expect(javelinMark(up)).toBeGreaterThanOrEqual(javelinMark(a));
      expect(maxLift(up)).toBeGreaterThan(maxLift(a));
      expect(longJumpMark(up)).toBeGreaterThanOrEqual(longJumpMark(a));
      expect(highJumpMark(up)).toBeGreaterThanOrEqual(highJumpMark(a));
      expect(pushForce(up)).toBeGreaterThan(pushForce(a));
    }
  });
  it("Speed", () => {
    for (const a of sample) {
      const up = withStats(a, { spe: a.stats.spe + 15 });
      for (const e of ["100m", "200m", "400m"] as const) expect(sprintMark(up, e)).toBeLessThan(sprintMark(a, e));
      for (const e of ["50m-freestyle", "100m-freestyle"] as const) expect(swimMark(up, e)).toBeLessThanOrEqual(swimMark(a, e) + 1e-9);
      expect(longJumpMark(up)).toBeGreaterThanOrEqual(longJumpMark(a));
    }
  });
});

describe("determinism: the same seed gives the same results", () => {
  const field = ["regieleki", "pikachu", "snorlax", "machamp", "gyarados", "lucario", "garchomp", "blaziken"].map(mon);
  it("every event", () => {
    for (const id of ["100m", "400m", "long-jump", "high-jump", "shot-put", "javelin", "weightlifting", "50m-freestyle", "100m-freestyle", "wrestling"] as const) {
      const a = runEvent(id, field, 7), b = runEvent(id, field, 7);
      expect(a.standings, id).toEqual(b.standings);
      expect([...a.marks.entries()], id).toEqual([...b.marks.entries()]);
    }
  });
  it("an athlete's day doesn't change because someone else joined", () => {
    const one = runLongJump(field.slice(0, 3), 5).cards.find((c) => c.athlete.key === "pikachu")!;
    const all = runLongJump(field, 5).cards.find((c) => c.athlete.key === "pikachu")!;
    expect(one.attempts.map((x) => x.mark)).toEqual(all.attempts.map((x) => x.mark));
  });
  it("another seed is another day", () => {
    const a = runThrow(field, "shot", 1).cards.map((c) => c.best), b = runThrow(field, "shot", 2).cards.map((c) => c.best);
    expect(a).not.toEqual(b);
  });
  it("form stays within ±1.5%, bell-shaped", () => {
    const rnd = rngFor(9, "form");
    const xs = Array.from({ length: 4000 }, () => formFactor(rnd));
    expect(Math.max(...xs)).toBeLessThanOrEqual(1 + FORM.spread);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(1 - FORM.spread);
    const near = xs.filter((x) => Math.abs(x - 1) < FORM.spread / 2).length / xs.length;
    expect(near).toBeGreaterThan(0.6);
  });
});

describe("the sprints", () => {
  it("reaction times run 0.12–0.20 s from Speed", () => {
    expect(meanReaction(0)).toBeCloseTo(SPRINT.reactionSlow, 9);
    expect(meanReaction(255)).toBeGreaterThan(SPRINT.reactionFast);
    expect(meanReaction(255)).toBeLessThan(0.125);
    expect(meanReaction(50)).toBeGreaterThan(meanReaction(150));
  });
  it("a false start (under 0.100 s) disqualifies, and it's rare", () => {
    let starts = 0, falses = 0;
    const fast = GAMES_ATHLETES.filter((a) => a.stats.spe >= 120).slice(0, 40);
    for (let seed = 1; seed <= 60; seed++) {
      for (let i = 0; i + 8 <= fast.length; i += 8) {
        const r = runSprint(fast.slice(i, i + 8), "100m", seed);
        starts += 8;
        if (r.falseStart) {
          falses++;
          const dq = r.runs.find((x) => x.athlete.key === r.falseStart!.key)!;
          expect(dq.dq).toBe(true);
          expect(r.falseStart.reaction).toBeLessThan(SPRINT.falseStart);
          expect(r.race.lanes.some((l) => l.entrant.key === dq.athlete.key)).toBe(false);
          expect(r.runs.filter((x) => !x.dq).every((x) => x.reaction >= SPRINT.falseStart)).toBe(true);
        }
      }
    }
    expect(falses / starts).toBeLessThan(0.01);
  });
  it("times are read to 1/100 rounded up; a tie there is split at 1/1000 (photo finish)", () => {
    expect(officialTime(9.581)).toBeCloseTo(9.59, 9);
    expect(officialTime(9.58)).toBeCloseTo(9.58, 9);
    expect(photoTime(9.5801)).toBeCloseTo(9.581, 9);
    expect(formatSeconds(9.581)).toBe("9.59");
    expect(formatSeconds(62.371)).toBe("1:02.38");
  });
  it("Regieleki wins the 100 m; Shuckle comes last", () => {
    const r = runSprint(["shuckle", "regieleki", "pikachu", "blissey"].map(mon), "100m", 3);
    expect(r.order[0].athlete.key).toBe("regieleki");
    expect(r.order[r.order.length - 1].athlete.key).toBe("shuckle");
  });
  it("draws the race the Race's scene draws: each runner waits its reaction, then the Race model's curve", () => {
    const r = runSprint(["regieleki", "pikachu"].map(mon), "100m", 4);
    for (const run of r.runs) {
      const lane = r.race.lanes.find((l) => l.entrant.key === run.athlete.key)!;
      expect(lane.time).toBeCloseTo(run.raw, 9);
      expect(lane.profile.finish).toBeCloseTo(run.raw, 9);
    }
  });
  it("more than eight run heats, then a final of eight", () => {
    const field = GAMES_ATHLETES.filter((a) => a.entrant.kind === "pokemon").slice(0, 20);
    const ev = sprintEvent(field, "200m", 11);
    expect(ev.heats?.length).toBeGreaterThan(0);
    expect(ev.final.runs).toHaveLength(8);
  });
});

describe("the long jump", () => {
  it("speed at take-off is the race model's after 40 m × 0.95, the vertical from Attack", () => {
    const p = jumpPhysics(ref);
    expect(p.vx).toBeCloseTo(0.95 * p.vRun, 9);
    expect(p.vRun).toBeGreaterThan(9.5);
    expect(p.vy).toBeCloseTo(LONG_JUMP.vVertical, 9);
    expect((Math.atan2(p.vy, p.vx) * 180) / Math.PI).toBeGreaterThan(17);
    expect((Math.atan2(p.vy, p.vx) * 180) / Math.PI).toBeLessThan(23);
  });
  it("heavy bodies get less spring; light ones no extra (Borelli's law)", () => {
    expect(spring(700)).toBeLessThan(0.7);
    expect(spring(7)).toBe(1);
    expect(jumpPhysics(withStats(mon("kartana"), {})).vy).toBeLessThan(5);
  });
  it("fouls about one jump in ten for the reference, more for faster jumpers", () => {
    const fouls = (a: Athlete) => {
      let f = 0;
      for (let s = 1; s <= 400; s++) if (runLongJump([a], s).cards[0].attempts[0].foul) f++;
      return f / 400;
    };
    const r = fouls(ref);
    expect(r).toBeGreaterThan(0.06);
    expect(r).toBeLessThan(0.15);
    expect(fouls(mon("regieleki"))).toBeGreaterThan(r);
  });
});

describe("the high jump", () => {
  it("clearance = centre of mass + rise + technique (Fosbury for bipeds, a penalty for four legs)", () => {
    const p = highJumpPhysics(ref);
    expect(p.com).toBeCloseTo(0.55 * 1.8, 9);
    expect(p.rise).toBeCloseTo((HIGH_JUMP.vVertical ** 2) / (2 * 9.81), 9);
    expect(p.technique).toBe(0.2);
    expect(highJumpPhysics(referenceAthlete({ shape: "quadruped" })).technique).toBe(-0.2);
    expect(highJumpPhysics(referenceAthlete({ shape: "squiggle" })).technique).toBe(-0.2);
    expect(highJumpPhysics(referenceAthlete({ shape: "ball" })).technique).toBe(0);
  });
  it("tall Pokémon start high: their centre of mass is already metres up", () => {
    expect(highJumpPhysics(mon("wailord")).com).toBeGreaterThan(3);
    expect(highJumpMark(mon("eternatus"))).toBeGreaterThan(highJumpMark(mon("pikachu")) * 5);
  });
});

describe("the throws", () => {
  it("the shot: 7.26 kg at 37° from 1.15 × height (capped at 30 m), with drag", () => {
    const p = throwPhysics(ref, "shot");
    expect((p.angle * 180) / Math.PI).toBe(37);
    expect(p.height).toBeCloseTo(1.15 * 1.8, 9);
    expect(throwPhysics(mon("eternatus"), "shot").height).toBeLessThanOrEqual(SHOT.releaseCap);
    // Drag shortens it, a little.
    const vac = p.v * Math.cos(p.angle) * ((p.v * Math.sin(p.angle) + Math.sqrt((p.v * Math.sin(p.angle)) ** 2 + 2 * 9.81 * p.height)) / 9.81);
    expect(p.distance - p.reach).toBeLessThan(vac);
    expect(p.distance - p.reach).toBeGreaterThan(vac * 0.97);
  });
  it("big bodies get a little extra speed from leverage, capped by the shot's mass", () => {
    expect(throwPhysics(referenceAthlete({ kg: 280 }), "shot").v).toBeGreaterThan(throwPhysics(ref, "shot").v);
    expect(loadFactor(7.26, 190)).toBeCloseTo(1, 9);
    expect(loadFactor(7.26, 10)).toBeLessThan(0.3);
    expect(loadFactor(7.26, 5)).toBe(0);
    expect(shotMark(mon("magikarp"))).toBe(0);
  });
  it("no arms: a head or tail flick at 60% of the speed", () => {
    const armed = throwPhysics(ref, "javelin"), armless = throwPhysics({ ...ref, arms: false }, "javelin");
    expect(armless.v / armed.v).toBeCloseTo(0.6, 6);
  });
  it("no Magikarp throws a shot 100 m: every throw stays under the limb-speed cap", () => {
    for (const a of GAMES_ATHLETES.filter((_, i) => i % 7 === 0)) {
      expect(throwPhysics(a, "shot").v).toBeLessThanOrEqual(31);
      expect(shotMark(a)).toBeLessThan(100);
    }
  });
});

describe("weightlifting and swimming", () => {
  it("loads real plates in 1 kg steps", () => {
    const l = loadBar(187)!;
    expect(l.bar).toBe(20);
    expect(l.collars).toBe(true);
    expect(l.bar + 2 * 2.5 + 2 * l.side.reduce((s, p) => s + p.kg, 0)).toBeCloseTo(187, 9);
    expect(l.side[0].kg).toBe(25);
    expect(loadBar(12)!.bar).toBe(10);
    expect(loadBar(1)).toBeNull();
  });
  it("aquatic factors: Water 1, fish × 1.15, Fire/Rock/Ground 0.4, the rest 0.55; Swift Swim only in rain", () => {
    expect(aquatic(mon("vaporeon")).factor).toBe(1);
    expect(aquatic(mon("goldeen")).factor).toBeCloseTo(1.15, 9);
    expect(aquatic(mon("charizard")).factor).toBe(0.4);
    expect(aquatic(mon("pikachu")).factor).toBe(0.55);
    const k = mon("kingdra");
    expect(k.traits & TRAIT.swiftSwim).toBeTruthy();
    expect(swimSpeed(k, true) / swimSpeed(k, false)).toBeCloseTo(Math.pow(2, 0.6), 6);
    expect(swimSpeed(mon("vaporeon"), true)).toBe(swimSpeed(mon("vaporeon"), false));
  });
  it("turns at 50 m in the 100 and stays in order", () => {
    const s = simulateSwim(ref, 100);
    expect(s.turn).not.toBeNull();
    expect(s.split!).toBeGreaterThan(20);
    expect(s.pushOff!).toBeGreaterThan(s.turn!);
    for (let i = 1; i < s.x.length; i++) expect(s.x[i]).toBeGreaterThanOrEqual(s.x[i - 1] - 1e-6);
  });
  it("a Water fish wins the swims", () => {
    const r = runSwim(["barraskewda", "pikachu", "charizard", "snorlax"].map(mon), "50m-freestyle", 1);
    expect(r.order[0].athlete.key).toBe("barraskewda");
  });
  it("rising bar: weights never go down an athlete's attempts", () => {
    const r = runLift(["snorlax", "machamp", "pikachu", "groudon"].map(mon), 3);
    for (const c of r.cards) for (let i = 1; i < c.attempts.length; i++) expect(c.attempts[i].weight).toBeGreaterThanOrEqual(c.attempts[i - 1].weight);
    for (let i = 1; i < r.sequence.length; i++) expect(r.sequence[i].weight).toBeGreaterThanOrEqual(r.sequence[i - 1].weight - 0);
  });
});

describe("wrestling", () => {
  it("a heavyweight pushes a featherweight out fast", () => {
    const b = bout(mon("snorlax"), mon("pikachu"), 1);
    expect(b.winner).toBe("a");
    expect(b.ringOut).toBe(true);
    expect(b.end).toBeLessThan(5);
  });
  it("a bracket has a gold, a silver and a bronze", () => {
    const br = runBracket(["snorlax", "machamp", "pikachu", "groudon", "hariyama", "conkeldurr"].map(mon), 2);
    expect(br.gold).toBeTruthy();
    expect(br.silver).toBeTruthy();
    expect(br.bronzeMedal).toBeTruthy();
    expect(new Set(br.order.map((a) => a.key)).size).toBe(6);
  });
});

describe("marks read out as the sport reads them", () => {
  it("formats", () => {
    expect(formatMark("long-jump", 8.419)).toBe("8.41 m");
    expect(formatMark("weightlifting", 1763.9)).toBe("1,763 kg");
    expect(formatMark("100m", 9.581)).toBe("9.59 s");
  });
  it("high jump countback and the bar's rules hold on a full field", () => {
    const r = runHighJump(GAMES_ATHLETES.filter((_, i) => i % 97 === 0).slice(0, 8), 3);
    for (const c of r.cards) {
      // Three failures in a row and you're out.
      let run = 0;
      for (const j of c.jumps) { run = j.cleared ? 0 : run + 1; expect(run).toBeLessThanOrEqual(3); }
    }
    for (let i = 1; i < r.heights.length; i++) expect(r.heights[i]).toBeGreaterThan(r.heights[i - 1]);
  });
});
