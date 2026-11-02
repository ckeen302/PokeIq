import { describe, expect, it } from "vitest";
import { calculate, Field, Generations, Move, Pokemon } from "@smogon/calc";
import { Dex } from "@pkmn/dex";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { hit, withCalcMemo } from "@/lib/battle/cpu-policy-legacy";
import { buildRoster, EXCLUDED_MOVES, unplayable } from "@/lib/mass-battle/roster-data";
import { DamageTable, rollsOf } from "@/lib/mass-battle/damage";
import { Battle, EV, EVENT_INTS, prepare, runHeadless, type Prepared } from "@/lib/mass-battle/engine";
import { battleStat, battleStats, EV as EVS, IV } from "@/lib/mass-battle/stats";
import { monotone, probesAround, questionSeeds, solve, spreadOf, type Evaluate } from "@/lib/mass-battle/solver";
import { decodeBattle, decodeQuestion, encodeBattle, encodeQuestion, MAX_SIDE, type SlugIndex } from "@/lib/mass-battle/share";
import { PRESETS, resolvePreset } from "@/lib/mass-battle/presets";
import type { BattleSpec, MBSpecies, Question } from "@/lib/mass-battle/types";
import { Director, type ArmySummary, type FieldSummary } from "@/lib/mass-battle/director";

const roster = buildRoster();
const bySlug = new Map(roster.species.map((s) => [s.slug, s]));
const mon = (slug: string): MBSpecies => {
  const s = bySlug.get(slug);
  if (!s) throw new Error(`no ${slug}`);
  return s;
};
const movesOf = (s: MBSpecies, level: 50 | 100 = 100) => s.moves[level].map((i) => roster.moves[i]);
const slugs: SlugIndex = { id: (slug) => bySlug.get(slug)?.id, slug: (id) => roster.species.find((s) => s.id === id)?.slug };
const gen = Generations.get(9);
const calcMon = (s: MBSpecies, level = 100) =>
  new Pokemon(gen, s.calc, { level, ability: s.ability, item: s.item || undefined, nature: "Hardy", evs: { hp: EVS, atk: EVS, def: EVS, spa: EVS, spd: EVS, spe: EVS }, ivs: { hp: IV, atk: IV, def: IV, spa: IV, spd: IV, spe: IV } });

const spec = (a: [string, number][], b: [string, number][], seed = 1, level: 50 | 100 = 100): BattleSpec => ({
  sides: [
    { units: a.map(([slug, count]) => ({ id: mon(slug).id, count })), formation: "swarm" },
    { units: b.map(([slug, count]) => ({ id: mon(slug).id, count })), formation: "line" },
  ],
  level,
  arena: "plains",
  seed,
});

describe("mass battle: the roster is the repo's real data", () => {
  it("every Pokémon is there with its Pokédex stats, types, size and art box", () => {
    expect(roster.species.length).toBe(POKEDEX.length);
    for (const p of POKEDEX) {
      const s = roster.species.find((x) => x.id === p.id)!;
      expect(s.base).toEqual(p.stats);
      expect(s.types).toEqual([...p.types]);
      expect(s.m).toBeCloseTo(p.height / 10, 10);
      expect(s.kg).toBeCloseTo(p.weight / 10, 10);
      expect(s.box).toHaveLength(5);
    }
  });

  it("random-battle Pokémon use their random-battle set; the rest their level-up moves", () => {
    const arceus = mon("arceus");
    expect(arceus.source).toBe("randbats");
    expect(movesOf(arceus).map((m) => m.name).sort()).toEqual(["Earthquake", "Extreme Speed", "Shadow Claw"]);
    expect(arceus.ability).toBe("Multitype");
    const karp = mon("magikarp");
    expect(karp.source).toBe("learnset");
    expect(movesOf(karp).map((m) => m.name).sort()).toEqual(["Flail", "Tackle"]);
    expect(karp.ability).toBe("Swift Swim");
    expect(karp.item).toBe("");
    // Pikachu keeps its Light Ball (the item that changes damage).
    expect(mon("pikachu").item).toBe("Light Ball");
  });

  it("no set carries a move the battle can't play, and none has more than four", () => {
    for (const s of roster.species) {
      for (const lv of [50, 100] as const) {
        expect(s.moves[lv].length).toBeLessThanOrEqual(4);
        for (const m of movesOf(s, lv)) {
          expect(unplayable(m.name)).toBeNull();
          expect(EXCLUDED_MOVES.has(Dex.moves.get(m.name).id)).toBe(false);
        }
      }
    }
  });

  it("move rules come from Showdown's data: targets, contact, priority, hits", () => {
    const by = new Map(roster.moves.map((m) => [m.name, m]));
    expect(by.get("Earthquake")).toMatchObject({ spread: true, contact: false, type: "Ground" });
    expect(by.get("Extreme Speed")).toMatchObject({ spread: false, contact: true, pri: 2 });
    for (const m of roster.moves) {
      const d = Dex.moves.get(m.name);
      expect(m.spread).toBe(d.target === "allAdjacent" || d.target === "allAdjacentFoes");
      expect(m.pri).toBe(d.priority);
      expect(m.contact).toBe(!!d.flags.contact);
    }
  });

  it("HP and Speed follow the games' stat formula and agree with the damage calculator", () => {
    for (const s of roster.species) {
      for (const level of [50, 100] as const) {
        const ours = battleStats(s, level);
        const c = calcMon(s, level);
        expect(ours.hp).toBe(c.maxHP());
        expect(ours.spe).toBe(c.stats.spe);
      }
    }
    expect(battleStat("hp", 20, 100)).toBe(202); // Magikarp
    expect(battleStat("hp", 1, 100, true)).toBe(1); // Shedinja
  });
});

describe("mass battle: the damage table is @smogon/calc", () => {
  const table = (a: string, b: string, level: 50 | 100 = 100) => {
    const prep = prepare(roster, spec([[a, 1]], [[b, 1]], 1, level));
    return { prep, table: new DamageTable(prep.species, prep.moves, prep.level) };
  };
  const full = (t: DamageTable, a: number, d: number) => ({ crit: false, spread: false, aHp: t.maxHp(a), aMax: t.maxHp(a), dHp: t.maxHp(d), dMax: t.maxHp(d) });
  const direct = (a: MBSpecies, d: MBSpecies, move: string, opts: { crit?: boolean; doubles?: boolean } = {}) =>
    rollsOf(calculate(gen, calcMon(a), calcMon(d), new Move(gen, move, { isCrit: opts.crit }), new Field({ gameType: opts.doubles ? "Doubles" : "Singles" })).damage);

  it("Magikarp's Tackle on Arceus: the calculator's 16 rolls", () => {
    const { prep, table: t } = table("magikarp", "arceus");
    const slot = prep.moves[0].findIndex((m) => m.name === "Tackle");
    const e = t.entry(0, slot, 1, full(t, 0, 1));
    expect(Array.from(e.hits[0])).toEqual(Array.from(direct(mon("magikarp"), mon("arceus"), "Tackle")[0]));
    expect(e.hits[0][0]).toBe(8);
    expect(e.hits[0][15]).toBe(10);
    // A critical hit is its own calculation.
    const c = t.entry(0, slot, 1, { ...full(t, 0, 1), crit: true });
    expect(Array.from(c.hits[0])).toEqual(Array.from(direct(mon("magikarp"), mon("arceus"), "Tackle", { crit: true })[0]));
  });

  it("Mewtwo's Psystrike on Rattata, and Earthquake's spread damage (the doubles 0.75)", () => {
    const { prep, table: t } = table("mewtwo", "rattata");
    const ps = prep.moves[0].findIndex((m) => m.name === "Psystrike");
    expect(Array.from(t.entry(0, ps, 1, full(t, 0, 1)).hits[0])).toEqual(Array.from(direct(mon("mewtwo"), mon("rattata"), "Psystrike")[0]));
    const a = table("arceus", "magikarp");
    const eq = a.prep.moves[0].findIndex((m) => m.name === "Earthquake");
    const single = a.table.entry(0, eq, 1, full(a.table, 0, 1));
    const spread = a.table.entry(0, eq, 1, { ...full(a.table, 0, 1), spread: true });
    expect(Array.from(spread.hits[0])).toEqual(Array.from(direct(mon("arceus"), mon("magikarp"), "Earthquake", { doubles: true })[0]));
    expect(spread.avg).toBeLessThan(single.avg * 0.8);
  });

  it("Huge Power doubles Azumarill's damage; Levitate makes Earthquake miss entirely", () => {
    const { prep, table: t } = table("azumarill", "arceus");
    const liq = prep.moves[0].findIndex((m) => m.name === "Liquidation");
    const ours = t.entry(0, liq, 1, full(t, 0, 1));
    const withHuge = direct(mon("azumarill"), mon("arceus"), "Liquidation")[0];
    expect(Array.from(ours.hits[0])).toEqual(Array.from(withHuge));
    const az = calcMon(mon("azumarill"));
    const plain = new Pokemon(gen, "Azumarill", { level: 100, ability: "Thick Fat", item: mon("azumarill").item, nature: "Hardy", evs: az.evs, ivs: az.ivs });
    const without = rollsOf(calculate(gen, plain, calcMon(mon("arceus")), new Move(gen, "Liquidation"), new Field()).damage)[0];
    expect(ours.avg).toBeGreaterThan((without.reduce((x, y) => x + y, 0) / 16) * 1.8);
    const lev = table("arceus", "bronzong");
    expect(mon("bronzong").ability).toBe("Levitate");
    const eq = lev.prep.moves[0].findIndex((m) => m.name === "Earthquake");
    expect(lev.table.entry(0, eq, 1, full(lev.table, 0, 1)).immune).toBe(true);
    expect(lev.table.canDamage(0, 1)).toBe(true); // Extreme Speed and Shadow Claw still land
  });

  it("Flail's power follows the attacker's HP, as in the games", () => {
    const { prep, table: t } = table("magikarp", "arceus");
    const flail = prep.moves[0].findIndex((m) => m.name === "Flail");
    const max = t.maxHp(0);
    const fullHp = t.entry(0, flail, 1, full(t, 0, 1)).avg;
    const low = t.entry(0, flail, 1, { ...full(t, 0, 1), aHp: 3 }).avg; // under 1/48: 200 power
    expect(low).toBeGreaterThan(fullHp * 8);
    expect(max).toBe(202);
  });

  it("agrees with the battle CPU's memoised hit() on expected damage", () => {
    const { prep, table: t } = table("arceus", "mewtwo");
    const a = calcMon(mon("arceus")), d = calcMon(mon("mewtwo"));
    withCalcMemo(() => {
      prep.moves[0].forEach((m, slot) => {
        const h = hit(gen, a, d, m.name, new Field({ gameType: "Singles" }));
        const e = t.entry(0, slot, 1, full(t, 0, 1));
        const lo = e.hits[0][0], hi = e.hits[0][15];
        const acc = m.acc ? m.acc / 100 : 1;
        expect(h.frac).toBeCloseTo((Math.min(1, (lo + hi) / 2 / t.maxHp(1)) * acc), 6);
      });
    });
  });
});

/** A battle with chosen species and moves, its units placed by hand. */
function handmade(units: { slug: string; side: 0 | 1; move: string; x: number; z: number }[], seed = 9): Battle {
  const species = units.map((u) => mon(u.slug));
  const moves = units.map((u) => [roster.moves.find((m) => m.name === u.move) ?? (() => { throw new Error(u.move); })()]);
  const prep: Prepared = {
    species,
    moves,
    level: 100,
    armies: [units.flatMap((u, i) => (u.side === 0 ? [[i, 1] as [number, number]] : [])), units.flatMap((u, i) => (u.side === 1 ? [[i, 1] as [number, number]] : []))],
    formations: ["line", "line"],
    seed,
  };
  const b = new Battle(prep);
  // Units are listed side A first; put each where the test wants it.
  const order = [...units.map((u, i) => ({ u, i })).filter((e) => e.u.side === 0), ...units.map((u, i) => ({ u, i })).filter((e) => e.u.side === 1)];
  order.forEach(({ u }, k) => {
    b.x[k] = u.x;
    b.z[k] = u.z;
    b.target[k] = -1;
  });
  // x = ±1 means "touching": each body's edge 5 cm from the middle.
  for (let k = 0; k < b.n; k++) if (Math.abs(b.x[k]) === 1) b.x[k] = Math.sign(b.x[k]) * (b.rows[b.sp[k]].radius + 0.05);
  for (let k = 0; k < b.n; k++) b.target[k] = b.findTarget(k);
  return b;
}

function firstRoundActors(b: Battle): number[] {
  const seen: number[] = [];
  for (let t = 0; t < 60 && !b.ended; t++) {
    b.step();
    for (let k = 0; k < b.eventCount; k++) {
      const actor = b.events[k * EVENT_INTS];
      if (!seen.includes(actor)) seen.push(actor);
    }
  }
  return seen;
}

describe("mass battle: rounds", () => {
  it("priority moves go first, whatever the Speed", () => {
    // Snorlax (Speed 30) with Extreme Speed (+2) against Mewtwo (Speed 130) with Psystrike, side by side.
    const b = handmade([
      { slug: "snorlax", side: 0, move: "Extreme Speed", x: -1, z: 0 },
      { slug: "mewtwo", side: 1, move: "Psystrike", x: 1, z: 0 },
    ]);
    expect(firstRoundActors(b)).toEqual([0, 1]);
  });

  it("without priority, the faster Pokémon acts first", () => {
    const b = handmade([
      { slug: "snorlax", side: 0, move: "Body Slam", x: -1, z: 0 },
      { slug: "mewtwo", side: 1, move: "Psystrike", x: 1, z: 0 },
    ]);
    expect(firstRoundActors(b)).toEqual([1, 0]);
    const c = handmade([
      { slug: "jolteon", side: 0, move: "Thunderbolt", x: -1, z: 0 },
      { slug: "snorlax", side: 1, move: "Body Slam", x: 1, z: 0 },
    ]);
    expect(firstRoundActors(c)).toEqual([0, 1]);
  });

  it("a fainted Pokémon doesn't act", () => {
    // Mewtwo's Psystrike knocks out a Rattata before the Rattata's turn comes.
    const b = handmade([
      { slug: "rattata", side: 0, move: "Tackle", x: -1, z: 0 },
      { slug: "mewtwo", side: 1, move: "Psystrike", x: 1, z: 0 },
    ]);
    expect(firstRoundActors(b)).toEqual([1]);
    expect(b.alive[0]).toBe(0);
  });
});

describe("mass battle: determinism", () => {
  const trace = (seed: number) => {
    const b = new Battle(prepare(roster, spec([["magikarp", 30]], [["arceus", 1]], seed)));
    let h = 17;
    while (!b.ended) {
      b.step();
      for (let k = 0; k < b.eventCount * EVENT_INTS; k++) h = (Math.imul(h, 31) + b.events[k]) | 0;
      h = (Math.imul(h, 31) + Math.round(b.x[0] * 1000)) | 0;
    }
    return { h, o: b.outcome() };
  };

  it("the same battle and seed play out identically, hit for hit", () => {
    const a = trace(42), b = trace(42);
    expect(a).toEqual(b);
    const c = trace(43);
    expect(c.h).not.toBe(a.h);
  });

  it("battles end with a winner, and 1 Mewtwo beats 1 Rattata", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const b = runHeadless(prepare(roster, spec([["rattata", 1]], [["mewtwo", 1]], seed)));
      expect(b.ended).toBe(true);
      expect(b.winner).toBe(1);
    }
  });

  it("an army that can't hurt the other side at all makes a draw (Normal moves against Gengar's Ghost type both ways)", () => {
    const prep = prepare(roster, spec([["snorlax", 1]], [["gengar", 1]], 3));
    // Snorlax with only Body Slam can't touch Gengar; Gengar with only Shadow Ball can't touch Snorlax.
    prep.moves[0] = [roster.moves.find((m) => m.name === "Body Slam")!];
    prep.moves[1] = [roster.moves.find((m) => m.name === "Shadow Ball")!];
    const b = runHeadless(prep);
    expect(b.winner).toBe(2);
    expect(b.seconds).toBeLessThan(5);
  });
});

describe("mass battle: neighbours", () => {
  it("each unit's foe is the nearest one it can hurt", () => {
    const b = new Battle(prepare(roster, spec([["rattata", 300], ["pidgey", 100]], [["magikarp", 250], ["gastly", 50]], 5)));
    for (let t = 0; t < 70; t++) b.step();
    const S = b.prep.species.length;
    let checked = 0;
    for (let i = 0; i < b.n; i++) {
      if (!b.alive[i]) continue;
      let best = Infinity;
      for (let j = 0; j < b.n; j++) {
        if (!b.alive[j] || b.side[j] === b.side[i] || !b.table.canDamage(b.sp[i], b.sp[j])) continue;
        best = Math.min(best, Math.hypot(b.x[j] - b.x[i], b.z[j] - b.z[i]));
      }
      if (best > 6) continue; // beyond the local search, units head for the other army's beacons
      const t = b.findTarget(i);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(Math.hypot(b.x[t] - b.x[i], b.z[t] - b.z[i])).toBeCloseTo(best, 9);
      checked++;
      void S;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("bodies don't pile up on each other", () => {
    const b = new Battle(prepare(roster, spec([["magikarp", 400]], [["arceus", 1]], 2)));
    for (let t = 0; t < 70 && !b.ended; t++) b.step();
    const r = (i: number) => b.rows[b.sp[i]].radius;
    let worst = 0;
    for (let i = 0; i < b.n; i++) {
      if (!b.alive[i]) continue;
      for (let j = i + 1; j < b.n; j++) {
        if (!b.alive[j]) continue;
        const overlap = r(i) + r(j) - Math.hypot(b.x[j] - b.x[i], b.z[j] - b.z[i]);
        worst = Math.max(worst, overlap / Math.min(r(i), r(j)));
      }
    }
    expect(worst).toBeLessThan(1);
  });
});

describe("mass battle: the solver", () => {
  const q: Question = { challenger: 129, boss: 493, level: 100, arena: "plains" };

  it("finds the smallest army that wins half its battles, on a known curve", async () => {
    // P(win | n) rises through 50% at n = 137; each seed decides by a fixed threshold.
    const evaluate: Evaluate = async (n, seeds, settled) => {
      let wins = 0, losses = 0;
      const wonSeeds: number[] = [], lostSeeds: number[] = [];
      for (const seed of seeds) {
        const u = (seed % 1000) / 1000;
        const p = 1 / (1 + Math.exp(-(n - 137) / 4));
        if (u < p) { wins++; wonSeeds.push(seed); } else { losses++; lostSeeds.push(seed); }
        if (settled(wins, losses)) break;
      }
      return { wins, runs: wins + losses, wonSeeds, lostSeeds };
    };
    const tried: number[] = [];
    const r = await solve(q, evaluate, (s) => tried.push(s.n));
    expect(r.answer).not.toBeNull();
    expect(Math.abs(r.answer! - 137)).toBeLessThanOrEqual(8);
    expect(r.wins * 2).toBeGreaterThanOrEqual(r.runs);
    expect(r.wonSeed).not.toBeNull();
    // One fewer loses more than it wins (a minimum, not just any winning size).
    const below = await evaluate(r.answer! - 1, questionSeeds(q), () => false);
    expect(below.wins * 2).toBeLessThan(below.runs + 8);
    expect(r.spread).toBeGreaterThanOrEqual(1);
    expect(tried[0]).toBe(1);
  });

  it("says so when no army up to the cap wins", async () => {
    const r = await solve(q, async (n, seeds) => ({ wins: 0, runs: seeds.length, wonSeeds: [], lostSeeds: seeds }), undefined, { maxN: 64 });
    expect(r.answer).toBeNull();
    expect(r.none).toBe("above-cap");
  });

  it("runs real battles: 1 Mewtwo beats 1 Rattata, so it takes more than one", async () => {
    const evaluate: Evaluate = async (n, seeds, settled) => {
      let wins = 0, losses = 0;
      const wonSeeds: number[] = [], lostSeeds: number[] = [];
      for (const seed of seeds) {
        const b = runHeadless(prepare(roster, { ...spec([["rattata", n]], [["mewtwo", 1]], seed) }));
        if (b.winner === 0) { wins++; wonSeeds.push(seed); } else { losses++; lostSeeds.push(seed); }
        if (settled(wins, losses)) break;
      }
      return { wins, runs: wins + losses, wonSeeds, lostSeeds };
    };
    const r = await solve({ challenger: mon("rattata").id, boss: mon("mewtwo").id, level: 100, arena: "plains" }, evaluate);
    expect(r.answer).toBeGreaterThan(1);
    expect(r.answer).toBeLessThan(50);
  });

  it("monotone rates and the spread", () => {
    expect(monotone([{ n: 1, wins: 0, runs: 10 }, { n: 2, wins: 6, runs: 10 }, { n: 3, wins: 4, runs: 10 }, { n: 4, wins: 10, runs: 10 }]).map((p) => p.rate)).toEqual([0, 0.5, 0.5, 1]);
    expect(spreadOf([{ n: 80, wins: 0, runs: 40 }, { n: 90, wins: 10, runs: 40 }, { n: 100, wins: 20, runs: 40 }, { n: 110, wins: 30, runs: 40 }, { n: 120, wins: 40, runs: 40 }])).toBe(10);
    expect(probesAround(3)).toEqual([1, 2, 4, 5]);
    expect(probesAround(100)).toEqual([80, 90, 110, 120]);
    expect(questionSeeds(q)).toEqual(questionSeeds(q));
  });
});

describe("mass battle: share links", () => {
  it("round-trips a battle and a question", () => {
    const s: BattleSpec = { sides: [{ units: [{ id: 19, count: 1000 }], formation: "swarm" }, { units: [{ id: 150, count: 1 }], formation: "line" }], level: 100, arena: "plains", seed: 123456 };
    const code = encodeBattle(s, slugs);
    expect(code).toBe(`1.100.plains.${(123456).toString(36)}.swarm.line.rattata*1000.mewtwo*1`);
    expect(new URLSearchParams({ b: code }).toString()).toBe(`b=${code}`);
    expect(decodeBattle(code, slugs)).toEqual(s);
    const mixed: BattleSpec = { sides: [{ units: [{ id: 1, count: 200 }, { id: 4, count: 200 }, { id: 7, count: 200 }], formation: "line" }, { units: [{ id: 122, count: 3 }], formation: "wedge" }], level: 50, arena: "colosseum", seed: 0 };
    expect(decodeBattle(encodeBattle(mixed, slugs), slugs)).toEqual(mixed);
    const qq: Question = { challenger: 129, boss: 493, level: 50, arena: "volcano" };
    expect(encodeQuestion(qq, slugs)).toBe("magikarp.arceus.50.volcano");
    expect(decodeQuestion(encodeQuestion(qq, slugs), slugs)).toEqual(qq);
  });

  it("refuses broken links and caps the army size", () => {
    for (const bad of ["", "2.100.plains.1.swarm.line.rattata*1.mewtwo*1", "1.70.plains.1.swarm.line.rattata*1.mewtwo*1", "1.100.moon.1.swarm.line.rattata*1.mewtwo*1", "1.100.plains.1.blob.line.rattata*1.mewtwo*1", "1.100.plains.1.swarm.line.notamon*1.mewtwo*1", "1.100.plains.1.swarm.line.rattata.mewtwo*1", "1.100.plains.1.swarm.line..mewtwo*1"]) {
      expect(decodeBattle(bad, slugs)).toBeNull();
    }
    const big = decodeBattle("1.100.plains.1.swarm.line.rattata*999999.mewtwo*1", slugs)!;
    expect(big.sides[0].units[0].count).toBe(MAX_SIDE);
    expect(decodeQuestion("magikarp.nobody", slugs)).toBeNull();
  });
});

describe("mass battle: presets", () => {
  it("every preset resolves to real armies", () => {
    for (const p of PRESETS) {
      const r = resolvePreset(p, roster);
      for (const side of r.spec.sides) {
        expect(side.units.length).toBeGreaterThan(0);
        for (const u of side.units) expect(roster.species.some((s) => s.id === u.id && s.moves[100].length > 0)).toBe(true);
      }
      if (p.question) expect(r.question).not.toBeNull();
    }
    const fw = resolvePreset(PRESETS.find((p) => p.id === "fire-vs-water")!, roster);
    const types = (id: number) => roster.species.find((s) => s.id === id)!.types;
    // Water on the blue side, Fire on the red.
    expect(fw.spec.sides[0].units.every((u) => types(u.id).includes("water") && !types(u.id).includes("fire"))).toBe(true);
    expect(fw.spec.sides[1].units.every((u) => types(u.id).includes("fire") && !types(u.id).includes("water"))).toBe(true);
  });
});

describe("mass battle: events", () => {
  it("every KO is a hit that took the last HP, and HP never goes below zero", () => {
    const b = new Battle(prepare(roster, spec([["pikachu", 40]], [["snorlax", 2]], 11)));
    let kos = 0;
    while (!b.ended) {
      b.step();
      for (let k = 0; k < b.eventCount; k++) {
        const o = k * EVENT_INTS;
        const target = b.events[o + 1];
        if (b.events[o + 4] & EV.KO) {
          kos++;
          expect(b.alive[target]).toBe(0);
        }
        expect(b.hp[target]).toBeGreaterThanOrEqual(0);
      }
    }
    const out = b.outcome();
    expect(kos).toBe(b.start[0] + b.start[1] - out.left[0] - out.left[1]);
  });
});

describe("mass battle: the presets' precomputed results", () => {
  it("match the engine (regenerate with scripts/mass-battle-presets.ts after changing the rules)", async () => {
    const { PRESET_RESULTS } = await import("@/lib/mass-battle/page-data");
    const { ENGINE_VERSION } = await import("@/lib/mass-battle/preset-results");
    expect(PRESET_RESULTS.engine).toBe(ENGINE_VERSION);
    expect(PRESET_RESULTS.roster).toBe(roster.version);
    for (const p of PRESETS) {
      const r = resolvePreset(p, roster);
      const saved = PRESET_RESULTS.results[p.id];
      expect(saved, p.id).toBeTruthy();
      // The cheap ones are replayed in full; every one must have a stored outcome.
      const units = r.spec.sides.reduce((a, s) => a + s.units.reduce((b, u) => b + u.count, 0), 0);
      if (units <= 1100) expect(runHeadless(prepare(roster, r.spec)).outcome(), p.id).toEqual(saved.outcome);
      if (p.kind === "howmany") {
        expect(saved.answer, p.id).not.toBeNull();
        // The battle the page shows at the answer is one the army wins.
        const q = r.question!;
        const shown = runHeadless(prepare(roster, { sides: [{ units: [{ id: q.challenger, count: saved.answer!.n }], formation: "swarm" }, { units: [{ id: q.boss, count: 1 }], formation: "line" }], level: q.level, arena: q.arena, seed: saved.answer!.seed }));
        expect(shown.winner).toBe(0);
      }
    }
  });
});

describe("mass battle: director", () => {
  it("the establishing shot keeps both armies in frame and apart, however long the wait", () => {
    const army = (cx: number, alive: number, h: number, extent: number): ArmySummary => ({ alive, start: alive, cx, cz: 0, extent, fx: cx > 0 ? cx - extent : cx + extent, fz: 0, h });
    // Signed horizontal angle from u to v.
    const angle = (ux: number, uz: number, vx: number, vz: number) => Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz);
    const fields: FieldSummary[] = [
      // 53 Magikarp and Arceus on a desktop stage, and two big armies on a squarer one.
      { t: 0, phase: "deploy", armies: [army(-21, 53, 0.9, 5), army(21, 1, 3.2, 1)], boss: { x: 21, z: 0, h: 3.2, side: 1 }, arena: 60, aspect: 1152 / 666 },
      { t: 0, phase: "deploy", armies: [army(-40, 2000, 1, 20), army(40, 2000, 1.6, 20)], boss: null, arena: 120, aspect: 1.2 },
    ];
    for (const field of fields) {
      const d = new Director();
      d.reset(field);
      for (let i = 0; i < 1800; i++) {
        const p = d.update(field, 0.1);
        if (i < 30) continue; // the glide in
        // The scene's convention: the camera sits at the target plus (sin yaw, cos yaw) × the level distance.
        const cp = Math.cos(p.pitch);
        const camX = p.tx + Math.sin(p.yaw) * cp * p.dist, camZ = p.tz + Math.cos(p.yaw) * cp * p.dist;
        const half = Math.atan(Math.tan(((p.fov / 2) * Math.PI) / 180) * field.aspect);
        const bearings = field.armies.map((a) => angle(p.tx - camX, p.tz - camZ, a.cx - camX, a.cz - camZ));
        for (const b of bearings) expect(Math.abs(b)).toBeLessThan(half);
        // Side by side, not one behind the other.
        expect(Math.abs(bearings[0] - bearings[1])).toBeGreaterThan(0.25);
      }
    }
  });
});
