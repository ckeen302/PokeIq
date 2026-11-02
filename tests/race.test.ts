import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { RACE_BY_KEY, RACE_ENTRANTS, RACE_FORM_ROWS, RACE_POKEMON } from "@/lib/race/data";
import { ACCEL, FADE, ceilingAt, enduranceFor, finishTime, motionAt, profileFor, runnerFor, sprintX, tauFor, timeToCover, topSpeed } from "@/lib/race/model";
import { ALEXANDER, FLIGHTLESS, cycleRate, froude, hipHeight, motionFor, relativeStride, strideFrequency, strideLength, wingbeatHz } from "@/lib/race/gait";
import { LANE_W, OUTER_R, STRAIGHT, X0, lanePoint, lapLength, loopPoint, measureRadius, stagger } from "@/lib/race/track";
import { assignLanes, displayTimes, formatGap, formatTime, leaderAt, makeRace, runnerAt, spotsAt } from "@/lib/race/race";
import { DEFAULT_PRESET, PRESETS, PRESET_BY_ID, PSEUDO_LEGENDARIES, predicted } from "@/lib/race/presets";
import { HUB_PRESET, RACE_PATH, RUN_PATH, VS_MAX, parseDistance, parseSeed, parseVs, presetPath, presetRunPath, pushRunner, vsOk, vsPath } from "@/lib/race/deeplink";
import { DEFAULT_SEED, heatSizes, knockout, mulberry32, nextCount, pathOf, shuffle } from "@/lib/race/tournament";
import { excitementAt, leaderReaches, photoWindow, planShow, raceTimeAt, shotAt } from "@/lib/race/broadcast";
import { fieldFor, heatFor, searchEntrants, specFor } from "@/lib/race/lineup";
import { cameraFor, fovToFit, type Spot } from "@/lib/race/director";
import { orbitBy, orbitFrom, orbitPose, wheelFactor, zoomBy, zoomFov } from "@/lib/race/orbit";
import { figureSize, fromRow, toRow, type Entrant } from "@/lib/race/types";

const mon = (key: string): Entrant => {
  const e = RACE_BY_KEY.get(key);
  if (!e) throw new Error(`no ${key}`);
  return e;
};
const time = (key: string, d: 100 | 200 | 400 = 100) => predicted(mon(key), d);

describe("data", () => {
  it("fields every Pokémon with its Pokédex stats, height and weight", () => {
    expect(RACE_POKEMON).toHaveLength(POKEDEX.length);
    for (const p of POKEDEX) {
      const e = mon(p.slug);
      expect(e.stats).toEqual(p.stats);
      expect(e.kg).toBeCloseTo(p.weight / 10, 6);
      expect(e.m).toBeCloseTo(p.height / 10, 6);
    }
  });
  it("forms carry their own PokéAPI stats (never the species' copied over)", () => {
    expect(RACE_FORM_ROWS.length).toBeGreaterThan(150);
    expect(mon("deoxys-speed").stats).toEqual({ hp: 50, atk: 95, def: 90, spa: 95, spd: 90, spe: 180 });
    expect(mon("aerodactyl-mega").stats.spe).toBe(150);
    expect(mon("calyrex-shadow").stats.spe).toBe(150);
    // No Gigantamax or Totem forms, no colour-only duplicates.
    expect(RACE_ENTRANTS.some((e) => /-gmax$|totem/.test(e.key))).toBe(false);
    expect(RACE_ENTRANTS.filter((e) => e.key.startsWith("minior-"))).toHaveLength(1);
  });
  it("every runner has a relief map and a render box", () => {
    for (const e of RACE_ENTRANTS) {
      expect(e.box[2]).toBeGreaterThan(0);
      const file = e.depth === "sizes" ? `public/sizes/depth/${e.art}.webp` : `public/race/depth/${e.art}.webp`;
      expect(existsSync(join(process.cwd(), file)), file).toBe(true);
    }
  });
  it("round-trips the compact wire format", () => {
    for (const k of ["pikachu", "deoxys-speed", "wailord", "rotom-wash", "raichu-alola"]) expect(fromRow(toRow(mon(k)))).toEqual(mon(k));
  });
  it("long serpents and fish are measured along their length", () => {
    expect(mon("wailord").length).toBe(true);
    const { w, h } = figureSize(mon("wailord"));
    expect(w).toBeCloseTo(14.5, 3);
    expect(h).toBeLessThan(w);
  });
});

describe("the race model", () => {
  it("scales top speed from base Speed: 100 Speed = 10 m/s", () => {
    expect(topSpeed(100)).toBe(10);
    expect(runnerFor(mon("regieleki").stats, mon("regieleki").kg).vmax).toBe(20);
    expect(runnerFor(mon("shuckle").stats, mon("shuckle").kg).vmax).toBeCloseTo(0.5, 9);
  });
  it("gets heavier Pokémon going more slowly and stronger ones sooner, within bounds", () => {
    expect(tauFor(70, 100)).toBeCloseTo(ACCEL.tau0, 9);
    expect(tauFor(700, 100)).toBeGreaterThan(tauFor(70, 100));
    expect(tauFor(70, 150)).toBeLessThan(tauFor(70, 100));
    for (const e of RACE_ENTRANTS) {
      const t = tauFor(e.kg, e.stats.atk);
      expect(t).toBeGreaterThanOrEqual(ACCEL.min);
      expect(t).toBeLessThanOrEqual(ACCEL.max);
    }
  });
  it("matches the Furusawa curve and solves x(T) = distance", () => {
    const r = runnerFor({ spe: 100, atk: 100, hp: 100 }, 70);
    const T = timeToCover(r, 100);
    expect(sprintX(r, T)).toBeCloseTo(100, 9);
    expect(finishTime(r, 100)).toBeCloseTo(T, 12);
    // A 10 m/s runner with τ = 1.3 s: 100 m in about 11.3 s.
    expect(T).toBeGreaterThan(11.2);
    expect(T).toBeLessThan(11.4);
  });
  it("distance only ever grows and times grow with the distance", () => {
    for (const k of ["regieleki", "pikachu", "snorlax", "shuckle", "blissey", "shedinja"]) {
      const e = mon(k);
      const r = runnerFor(e.stats, e.kg);
      const p = profileFor(r, 400);
      let last = -1;
      for (let t = 0; t <= p.finish + 3; t += p.finish / 400) {
        const m = motionAt(p, t);
        expect(m.x).toBeGreaterThanOrEqual(last - 1e-9);
        last = m.x;
      }
      expect(finishTime(r, 100)).toBeLessThan(finishTime(r, 200));
      expect(finishTime(r, 200)).toBeLessThan(finishTime(r, 400));
      expect(motionAt(p, p.finish).x).toBeCloseTo(400, 3);
    }
  });
  it("base Speed decides; acceleration separates equal Speeds", () => {
    expect(time("regieleki")).toBeLessThan(time("ninjask"));
    expect(time("ninjask")).toBeLessThan(time("pheromosa"));
    // Deoxys and Electrode both have 150 Speed: Deoxys (60.8 kg, 150 Attack) gets away faster than Electrode (66.6 kg, 50 Attack).
    expect(mon("deoxys").stats.spe).toBe(mon("electrode").stats.spe);
    expect(time("deoxys")).toBeLessThan(time("electrode"));
    // Over the whole Pokédex, a Pokémon with 5% more Speed almost always wins the 100 m.
    let pairs = 0, upsets = 0;
    for (let i = 0; i < RACE_POKEMON.length; i += 3) {
      for (let j = i + 1; j < RACE_POKEMON.length; j += 5) {
        const a = RACE_POKEMON[i], b = RACE_POKEMON[j];
        const hi = Math.max(a.stats.spe, b.stats.spe), lo = Math.min(a.stats.spe, b.stats.spe);
        if ((hi - lo) / hi < 0.05) continue;
        pairs++;
        const faster = a.stats.spe > b.stats.spe ? a : b, slower = faster === a ? b : a;
        if (predicted(faster, 100) > predicted(slower, 100)) upsets++;
      }
    }
    expect(upsets / pairs).toBeLessThan(0.001);
  });
  it("HP is stamina: no fade over 100 m, a fade after 150 m that falls with HP", () => {
    expect(FADE.onset).toBe(150);
    const base = { spe: 100, atk: 100 };
    const lowHp = runnerFor({ ...base, hp: 20 }, 70), highHp = runnerFor({ ...base, hp: 200 }, 70);
    expect(finishTime(lowHp, 100)).toBeCloseTo(finishTime(highHp, 100), 9);
    expect(finishTime(lowHp, 200)).toBeGreaterThan(finishTime(highHp, 200));
    expect(finishTime(lowHp, 400) - finishTime(highHp, 400)).toBeGreaterThan(finishTime(lowHp, 200) - finishTime(highHp, 200));
    expect(enduranceFor(255)).toBeGreaterThan(enduranceFor(100));
    // 100 HP: about 96% of top speed held at 200 m, 84% at 400 m.
    const mid = runnerFor({ ...base, hp: 100 }, 70);
    expect(ceilingAt(mid, 200) / mid.vmax).toBeCloseTo(0.96, 2);
    expect(ceilingAt(mid, 400) / mid.vmax).toBeCloseTo(0.84, 2);
    expect(ceilingAt(mid, 120)).toBe(mid.vmax);
  });
  it("gives the example finish times", () => {
    expect(formatTime(time("regieleki"))).toBe("6.38");
    expect(formatTime(time("ninjask"))).toBe("7.36");
    expect(formatTime(time("pikachu"))).toBe("12.22");
    expect(formatTime(time("snorlax"))).toBe("34.88");
    expect(formatTime(time("shuckle"))).toBe("3:21.62");
  });
});

describe("gait (Alexander's dynamic similarity)", () => {
  it("relative stride length is 2.3 · Fr^0.3", () => {
    expect(ALEXANDER).toEqual({ k: 2.3, exp: 0.3 });
    // At Fr = 1, λ = 2.3; at Fr = 10, λ = 2.3 · 10^0.3 ≈ 4.59.
    const h = 1;
    const v1 = Math.sqrt(9.81 * h);
    expect(froude(v1, h)).toBeCloseTo(1, 9);
    expect(relativeStride(v1, h)).toBeCloseTo(2.3, 9);
    expect(relativeStride(Math.sqrt(98.1), h)).toBeCloseTo(2.3 * Math.pow(10, 0.3), 6);
    expect(strideLength(v1, h)).toBeCloseTo(2.3, 9);
    expect(strideFrequency(v1, h)).toBeCloseTo(v1 / 2.3, 9);
  });
  it("small Pokémon patter, giants lope", () => {
    // Same speed: a 0.3 m hip strides more often than a 3 m hip.
    expect(strideFrequency(5, 0.3)).toBeGreaterThan(strideFrequency(5, 3) * 1.5);
    expect(strideLength(5, 3)).toBeGreaterThan(strideLength(5, 0.3));
    expect(hipHeight(1.7, "upright")).toBeCloseTo(0.816, 3);
    expect(hipHeight(1, "quadruped")).toBeGreaterThan(hipHeight(1, "upright"));
  });
  it("beats wings slower as fliers get heavier (∝ mass^-1/3)", () => {
    expect(wingbeatHz(0.4)).toBeCloseTo(7, 9);
    expect(wingbeatHz(3.2)).toBeCloseTo(3.5, 6);
    expect(cycleRate("fly", 10, 1, 0.01)).toBeLessThanOrEqual(12);
  });
  it("chooses how each Pokémon moves from its shape, types and abilities", () => {
    expect(mon("gengar").motion).toBe("run");
    expect(mon("gastly").motion).toBe("hover");
    expect(mon("rotom").motion).toBe("hover");
    expect(mon("pidgeot").motion).toBe("fly");
    expect(mon("ninjask").motion).toBe("fly");
    expect(mon("dodrio").motion).toBe("run");
    expect(FLIGHTLESS.has(85)).toBe(true);
    expect(mon("ekans").motion).toBe("slither");
    expect(mon("magikarp").motion).toBe("flop");
    expect(mon("electrode").motion).toBe("roll");
    expect(mon("rapidash").motion).toBe("gallop");
    expect(mon("shuckle").motion).toBe("scuttle");
    expect(mon("regieleki").motion).toBe("run");
    expect(motionFor({ shape: "blob", types: ["normal"], abilities: [], species: 1 })).toBe("bounce");
  });
});

describe("the track", () => {
  it("is a regulation 400 m track with staggered starts", () => {
    expect(measureRadius(1)).toBeCloseTo(36.8, 9);
    expect(lapLength(1)).toBeCloseTo(400, 1);
    expect(stagger(2, 400)).toBeCloseTo(7.04, 2);
    expect(stagger(2, 200)).toBeCloseTo(3.52, 2);
    expect(stagger(8, 100)).toBe(0);
    expect(OUTER_R).toBeCloseTo(36.5 + 8 * LANE_W, 9);
  });
  it("puts every lane's finish on the common line at the end of the home straight", () => {
    for (const d of [100, 200, 400] as const) {
      for (let lane = 1; lane <= 8; lane++) {
        const p = lanePoint(lane, d, d);
        expect(p.x).toBeCloseTo(X0, 6);
        expect(p.dx).toBeCloseTo(1, 9);
      }
    }
    expect(lanePoint(4, 100, 0).x).toBeCloseTo(X0 - 100, 9);
  });
  it("runs a continuous path round the loop", () => {
    const rm = measureRadius(3);
    let prev = loopPoint(0, rm, rm);
    for (let u = 0.5; u < lapLength(3); u += 0.5) {
      const p = loopPoint(u, rm, rm);
      expect(Math.hypot(p.x - prev.x, p.z - prev.z)).toBeLessThan(0.51);
      prev = p;
    }
    expect(STRAIGHT).toBe(84.39);
  });
});

describe("a race", () => {
  const field = PRESET_BY_ID.get("fastest-eight")!.pick(RACE_ENTRANTS, 100);
  const race = makeRace(field, 100);
  it("seeds the lanes like a final: the favourites in the middle", () => {
    const lanes = assignLanes(field, 100);
    expect(new Set(lanes).size).toBe(8);
    expect(race.order[0].lane).toBe(4);
    expect(race.order[1].lane).toBe(5);
    expect(assignLanes([mon("pikachu"), mon("eevee")], 100).sort()).toEqual([4, 5]);
  });
  it("places by finish time with gaps", () => {
    expect(race.order[0].entrant.key).toBe("regieleki");
    race.order.forEach((r, k) => {
      expect(r.place).toBe(k + 1);
      if (k) expect(r.time).toBeGreaterThan(race.order[k - 1].time);
    });
    expect(formatGap(race.order[1].gap)).toMatch(/^\+0\.\d\d$/);
    expect(leaderAt(race, 3).entrant.key).toBe("regieleki");
  });
  it("shares a place on identical times and shows near ties to the thousandth", () => {
    const tie = makeRace([mon("pikachu"), { ...mon("pikachu"), key: "pikachu-2" }], 100);
    expect(tie.order[0].place).toBe(1);
    expect(tie.order[1].place).toBe(1);
    const eevee = makeRace(PRESET_BY_ID.get("eeveelutions")!.pick(RACE_ENTRANTS, 100), 100);
    const shown = [...displayTimes(eevee).values()];
    expect(shown.some((s) => /\.\d{3}$/.test(s))).toBe(true);
  });
  it("knows where everyone is", () => {
    const r = race.lanes[0];
    const at = runnerAt(race, r, r.time);
    expect(at.point.x).toBeCloseTo(X0, 3);
    expect(spotsAt(race, 0).every((s) => s.s === 0)).toBe(true);
    expect(formatTime(75.5)).toBe("1:15.50");
  });
});

describe("presets", () => {
  it("has 8 to 10 presets, each a field of 2 to 8 (or a tournament)", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(PRESETS.length).toBeLessThanOrEqual(10);
    expect(DEFAULT_PRESET.id).toBe(HUB_PRESET);
    for (const p of PRESETS) {
      const list = p.pick(RACE_ENTRANTS, p.distance);
      if (p.tournament) { expect(list).toHaveLength(POKEDEX.length); continue; }
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list.length).toBeLessThanOrEqual(8);
      expect(new Set(list.map((e) => e.key)).size).toBe(list.length);
      expect(p.hook.length).toBeGreaterThan(5);
      expect(`${p.title} ${p.blurb} ${p.hook}`).not.toMatch(/olympic/i);
    }
  });
  it("picks from the data", () => {
    expect(PRESET_BY_ID.get("shuckle-vs-regieleki")!.pick(RACE_ENTRANTS, 100).map((e) => e.key)).toEqual(["shuckle", "regieleki"]);
    const fastest = PRESET_BY_ID.get("fastest-eight")!.pick(RACE_ENTRANTS, 100);
    expect(fastest[0].key).toBe("regieleki");
    expect(fastest.every((e) => e.kind === "pokemon")).toBe(true);
    expect(PRESET_BY_ID.get("slowest-eight")!.pick(RACE_ENTRANTS, 100).map((e) => e.key)).toContain("shuckle");
    expect(PRESET_BY_ID.get("gen-1-final")!.pick(RACE_ENTRANTS, 100).every((e) => e.gen === 1)).toBe(true);
    expect(PRESET_BY_ID.get("eeveelutions")!.pick(RACE_ENTRANTS, 100).map((e) => e.species)).toEqual([134, 135, 136, 196, 197, 470, 471, 700]);
    const heavy = PRESET_BY_ID.get("heavyweights")!.pick(RACE_ENTRANTS, 100);
    expect(heavy[0].kg).toBeGreaterThanOrEqual(heavy[7].kg);
  });
  it("lists the real pseudo-legendaries: non-legendary, fully evolved, 600 base stat total", () => {
    for (const id of PSEUDO_LEGENDARIES) {
      const p = POKEDEX.find((x) => x.id === id)!;
      expect(p.bst).toBe(600);
      expect(p.stage).toBe(3);
      expect(p.legendary || p.mythical).toBe(false);
    }
  });
});

describe("links", () => {
  it("builds and reads share links", () => {
    expect(presetPath(HUB_PRESET)).toBe(RACE_PATH);
    expect(presetPath("starters")).toBe("/pokedex/race/starters");
    expect(vsPath(["regieleki", "shuckle"], 100)).toBe(`${RUN_PATH}?vs=regieleki,shuckle`);
    expect(vsPath(["regieleki", "shuckle"], 400)).toBe(`${RUN_PATH}?vs=regieleki,shuckle&d=400`);
    expect(presetRunPath("starters", 200)).toBe(`${RUN_PATH}?run=starters&d=200`);
    expect(presetRunPath("every-pokemon", 100, 7)).toBe(`${RUN_PATH}?run=every-pokemon&seed=7`);
    const known = (k: string) => RACE_BY_KEY.has(k);
    expect(parseVs("Regieleki,shuckle,nope,REGIELEKI,Mr_Mime", known)).toEqual(["regieleki", "shuckle", "mr-mime"]);
    expect(parseVs(Array.from({ length: 12 }, (_, i) => POKEDEX[i].slug).join(","), known)).toHaveLength(VS_MAX);
    expect(vsOk(1)).toBe(false);
    expect(vsOk(8)).toBe(true);
    expect(parseDistance("200")).toBe(200);
    expect(parseDistance("150")).toBeNull();
    expect(parseSeed("42")).toBe(42);
    expect(parseSeed("-1")).toBeNull();
    expect(pushRunner(["a", "b"], "a")).toEqual(["a", "b"]);
    expect(pushRunner(["a", "b", "c", "d", "e", "f", "g", "h"], "i")).toEqual(["b", "c", "d", "e", "f", "g", "h", "i"]);
  });
});

describe("the knockout tournament", () => {
  const field = RACE_POKEMON.map((e) => ({ key: e.key, time: predicted(e, 100) }));
  const t = knockout(field);
  it("draws everyone into heats of at most eight", () => {
    const first = t.rounds[0];
    const keys = first.heats.flatMap((h) => h.results.map((r) => r.key));
    expect(keys).toHaveLength(field.length);
    expect(new Set(keys).size).toBe(field.length);
    for (const round of t.rounds) for (const h of round.heats) expect(h.results.length).toBeLessThanOrEqual(8);
    expect(heatSizes(1025).reduce((a, b) => a + b, 0)).toBe(1025);
    expect(Math.max(...heatSizes(1025)) - Math.min(...heatSizes(1025))).toBeLessThanOrEqual(1);
  });
  it("advances the top places and the fastest losers, down to an eight-runner final", () => {
    for (let i = 0; i < t.rounds.length - 1; i++) {
      const round = t.rounds[i];
      const through = round.heats.flatMap((h) => h.results.filter((r) => r.q));
      const next = t.rounds[i + 1].heats.flatMap((h) => h.results);
      expect(through.length).toBe(next.length);
      expect(through.length % 8).toBe(0);
      for (const h of round.heats) {
        // Q: the first places of each heat, in time order.
        h.results.forEach((r, k) => expect(r.place).toBe(k + 1));
        expect(h.results.filter((r) => r.q === "Q").every((r) => r.place <= round.byPlace)).toBe(true);
        for (let k = 1; k < h.results.length; k++) expect(h.results[k].time).toBeGreaterThanOrEqual(h.results[k - 1].time);
      }
      // q: no eliminated runner was faster than a fastest loser.
      const q = round.heats.flatMap((h) => h.results.filter((r) => r.q === "q"));
      const out = round.heats.flatMap((h) => h.results.filter((r) => !r.q));
      if (q.length && out.length) expect(Math.min(...out.map((r) => r.time))).toBeGreaterThanOrEqual(Math.max(...q.map((r) => r.time)));
    }
    expect(t.rounds.at(-1)!.name).toBe("Final");
    expect(t.rounds[0].name).toBe("Heats");
    expect(t.finalists).toHaveLength(8);
    expect(t.champion).toBe("regieleki");
    expect(nextCount(1025)).toBe(256);
  });
  it("is deterministic for a seed and traces any runner", () => {
    const again = knockout(field, DEFAULT_SEED);
    expect(again.rounds[0].heats[5].results.map((r) => r.key)).toEqual(t.rounds[0].heats[5].results.map((r) => r.key));
    const other = knockout(field, DEFAULT_SEED + 1);
    expect(other.rounds[0].heats[5].results.map((r) => r.key)).not.toEqual(t.rounds[0].heats[5].results.map((r) => r.key));
    const path = pathOf(t, "pikachu");
    expect(path.length).toBe((t.reached.get("pikachu") ?? 0) + 1);
    expect(shuffle([1, 2, 3, 4, 5], 9).sort()).toEqual([1, 2, 3, 4, 5]);
    const rnd = mulberry32(1);
    expect(rnd()).not.toBe(rnd());
  });
});

describe("the broadcast", () => {
  const race = makeRace(PRESET_BY_ID.get("fastest-eight")!.pick(RACE_ENTRANTS, 100), 100);
  const plan = planShow(race);
  it("runs crane, lane intros, marks and set, then the gun", () => {
    expect(plan.shots[0].camera).toBe("crane");
    expect(plan.shots.filter((s) => s.phase === "intro")).toHaveLength(8);
    expect(plan.shots.find((s) => s.phase === "set")!.t1).toBeCloseTo(plan.gun, 9);
    expect(raceTimeAt(plan, plan.gun - 0.5)).toBe(0);
    for (let i = 1; i < plan.shots.length; i++) expect(plan.shots[i].t0).toBeCloseTo(plan.shots[i - 1].t1, 9);
  });
  it("keeps the race clock live through the race, then replays the finish in slow motion", () => {
    let last = -1;
    for (let t = plan.gun; t < plan.shots.find((s) => s.phase === "replay")!.t0; t += 0.05) {
      const rt = raceTimeAt(plan, t);
      expect(rt).toBeGreaterThanOrEqual(last - 1e-9);
      last = rt;
    }
    const replay = plan.shots.find((s) => s.phase === "replay")!;
    expect(replay.rate).toBeLessThan(1);
    expect(replay.race0).toBeLessThan(race.first);
    expect(replay.race0 + (replay.t1 - replay.t0) * replay.rate).toBeGreaterThan(race.first);
    expect(shotAt(plan, plan.end + 10).phase).toBe("results");
    expect(leaderReaches(race, 50)).toBeLessThan(race.first);
  });
  it("fast-forwards a slow field and its stragglers", () => {
    const duel = makeRace(PRESET_BY_ID.get("shuckle-vs-regieleki")!.pick(RACE_ENTRANTS, 100), 100);
    const p = planShow(duel, { video: true });
    const ff = p.shots.filter((s) => s.phase === "fast");
    expect(ff.length).toBeGreaterThan(0);
    expect(ff[0].rate).toBeGreaterThan(10);
    expect(p.end).toBeLessThan(40);
    const quick = planShow(duel, { quick: true });
    expect(quick.shots[0].phase).toBe("marks");
  });
  it("frames runners from the front or three quarters, never edge-on", () => {
    const spots = spotsAt(race, 0);
    const ctx = { distance: 100 as const, aspect: 16 / 9, starts: spots };
    for (const s of spots) {
      const pose = cameraFor("intro", 0.5, spots, { ...ctx, lane: s.lane });
      const toCam = [pose.pos[0] - s.x, pose.pos[2] - s.z];
      const along = (toCam[0] * s.dx + toCam[1] * s.dz) / Math.hypot(toCam[0], toCam[1]);
      // In front of the runner, at most about 50° off head-on.
      expect(along).toBeGreaterThan(Math.cos((52 * Math.PI) / 180));
    }
    const mid: Spot[] = spotsAt(race, 4);
    const head = cameraFor("headon", 0.5, mid, ctx);
    expect(head.pos[0]).toBeGreaterThan(X0);
    expect(head.fov).toBeLessThan(30);
    expect(fovToFit(10, 2, 20, 16 / 9)).toBeGreaterThan(fovToFit(10, 2, 40, 16 / 9));
  });
});

describe("the free camera", () => {
  it("orbits, zooms and pinches", () => {
    const o = orbitFrom({ pos: [10, 5, 30], target: [0, 0, 0], fov: 40 });
    const back = orbitPose(o);
    expect(back.pos[0]).toBeCloseTo(10, 6);
    expect(back.pos[1]).toBeCloseTo(5, 6);
    expect(back.pos[2]).toBeCloseTo(30, 6);
    expect(zoomBy(o, 2).dist).toBeCloseTo(o.dist / 2, 6);
    expect(zoomBy(o, 1e6).dist).toBeGreaterThan(1);
    // Wheel down (positive deltaY) zooms out; a trackpad pinch (ctrl) responds to small deltas.
    expect(wheelFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(Math.abs(Math.log(wheelFactor(-5, 0, true)))).toBeGreaterThan(Math.abs(Math.log(wheelFactor(-5, 0, false))));
    expect(orbitBy(o, 0, 10000, 800).pitch).toBeLessThanOrEqual(1.5);
    expect(zoomFov(40, 2)).toBeLessThan(40);
  });
});

describe("lineups and search", () => {
  it("runs a preset, a custom field, a heat and the knockout's final", () => {
    expect(fieldFor(specFor("shuckle-vs-regieleki"), RACE_ENTRANTS).entrants.map((e) => e.key)).toEqual(["shuckle", "regieleki"]);
    const custom = fieldFor(specFor("fastest-eight", ["pikachu", "raichu-alola"], 200), RACE_ENTRANTS);
    expect(custom.title).toBe("Pikachu vs Alolan Raichu");
    expect(custom.hook).toMatch(/😳$/);
    const heat = heatFor(mon("pikachu"), RACE_ENTRANTS, 100);
    expect(heat).toHaveLength(8);
    expect(heat[0].key).toBe("pikachu");
    expect(heat.every((e) => Math.abs(predicted(e, 100) - predicted(mon("pikachu"), 100)) < 1)).toBe(true);
    expect(fieldFor(specFor("fastest-eight", ["pikachu"]), RACE_ENTRANTS).title).toBe("Pikachu's heat");
    const ko = fieldFor(specFor("every-pokemon"), RACE_ENTRANTS);
    expect(ko.tournament).not.toBeNull();
    expect(ko.entrants.map((e) => e.key)).toEqual(ko.tournament!.finalists);
  });
  it("finds Pokémon and forms by name or number", () => {
    expect(searchEntrants(RACE_ENTRANTS, "pika")[0].key).toBe("pikachu");
    expect(searchEntrants(RACE_ENTRANTS, "#25")[0].key).toBe("pikachu");
    expect(searchEntrants(RACE_ENTRANTS, "deoxys").map((e) => e.key)).toContain("deoxys-speed");
    expect(searchEntrants(RACE_ENTRANTS, "flabebe")[0].key).toBe("flabebe");
    expect(searchEntrants(RACE_ENTRANTS, "  ")).toEqual([]);
  });
  it("hushes the crowd for the start and frames the photo finish on the leaders", () => {
    const race = makeRace(PRESET_BY_ID.get("fastest-eight")!.pick(RACE_ENTRANTS, 100), 100);
    const plan = planShow(race);
    const set = plan.shots.find((s) => s.phase === "set")!;
    expect(excitementAt(plan, race, set.t0 + 0.1)).toBeLessThan(0.1);
    const fin = plan.shots.find((s) => s.phase === "race" && s.race0 <= race.first && s.race0 + (s.t1 - s.t0) >= race.first)!;
    expect(excitementAt(plan, race, fin.t0 + (race.first - fin.race0) + 0.05)).toBeGreaterThan(0.9);
    const w = photoWindow(race);
    expect(w.from).toBeLessThan(race.first);
    expect(w.to).toBeGreaterThan(race.order[1].time);
  });
});
