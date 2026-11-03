import { describe, expect, it } from "vitest";
import { calculate, Field, Generations, Move } from "@smogon/calc";
import { Dex } from "@pkmn/dex";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { hit, withCalcMemo } from "@/lib/battle/cpu-policy-legacy";
import { buildLearnsets, buildRoster, EXCLUDED_MOVES, unplayable } from "@/lib/mass-battle/roster-data";
import { calcPokemon, DamageTable, neutralState, rollsOf, type Fighter } from "@/lib/mass-battle/damage";
import { Battle, EV, EVENT_INTS, NOTE, NOTE_INTS, prepare, runHeadless, type Prepared } from "@/lib/mass-battle/engine";
import { battleStat, battleStats } from "@/lib/mass-battle/stats";
import { defaultMoves, expandSpec, factsOf, groupLabel, groupMembers, matchesGroup, resolveSet, spreadOf as evSpread } from "@/lib/mass-battle/sets";
import { monotone, probesAround, questionSeeds, solve, spreadOf, winsNeeded, type Evaluate } from "@/lib/mass-battle/solver";
import { decodeBattle, decodePlayback, decodeQuestion, encodeBattle, encodePlayback, encodeQuestion, MAX_SIDE, questionKey, questionSpec, simpleQuestion, type SlugIndex } from "@/lib/mass-battle/share";
import { PRESETS, resolvePreset } from "@/lib/mass-battle/presets";
import { defaultSetup, fromBattle, fromQuestion, toBattle, toQuestion } from "@/lib/mass-battle/setup";
import { STATUS, type BattleSpec, type MBSpecies, type Question, type SetChoice } from "@/lib/mass-battle/types";
import { Director, type ArmySummary, type FieldSummary } from "@/lib/mass-battle/director";
import { crossCheck, MATCHUPS, wilson, zScore } from "../scripts/mass-battle-crosscheck";

const roster = buildRoster();
const bySlug = new Map(roster.species.map((s) => [s.slug, s]));
const mon = (slug: string): MBSpecies => {
  const s = bySlug.get(slug);
  if (!s) throw new Error(`no ${slug}`);
  return s;
};
const movesOf = (s: MBSpecies, level = 100) => defaultMoves(s, roster.moves, level);
const move = (name: string) => roster.moves.find((m) => m.name === name) ?? (() => { throw new Error(name); })();
const slugs: SlugIndex = { id: (slug) => bySlug.get(slug)?.id, slug: (id) => roster.species.find((s) => s.id === id)?.slug };
const gen = Generations.get(9);
const fighter = (slug: string, choice?: SetChoice, level = 100, items: "none" | "sets" = "none"): Fighter => ({ species: mon(slug), set: resolveSet(mon(slug), roster, choice, level, items) });

const spec = (a: [string, number][], b: [string, number][], seed = 1, level = 100, extra: Partial<BattleSpec> = {}): BattleSpec => ({
  sides: [
    { units: a.map(([slug, count]) => ({ id: mon(slug).id, count })), formation: "swarm" },
    { units: b.map(([slug, count]) => ({ id: mon(slug).id, count })), formation: "line" },
  ],
  level,
  arena: "plains",
  seed,
  ...extra,
});

describe("mass battle: the roster is the repo's real data", () => {
  it("every Pokémon is there with its Pokédex stats, types, size and art box, and the battle forms with Showdown's", () => {
    const defaults = roster.species.filter((s) => s.form === "");
    expect(defaults.length).toBe(POKEDEX.length);
    for (const p of POKEDEX) {
      const s = roster.species.find((x) => x.id === p.id)!;
      expect(s.base).toEqual(p.stats);
      expect(s.types).toEqual([...p.types]);
      expect(s.m).toBeCloseTo(p.height / 10, 10);
      expect(s.kg).toBeCloseTo(p.weight / 10, 10);
      expect(s.box).toHaveLength(5);
    }
    const megaX = mon("charizard-mega-x");
    expect(megaX.form).toBe("mega");
    expect(megaX.types).toEqual(["fire", "dragon"]);
    expect(megaX.base).toEqual({ hp: 78, atk: 130, def: 111, spa: 130, spd: 85, spe: 100 });
    expect(megaX.ability).toBe("Tough Claws");
    const raichu = mon("raichu-alola");
    expect(raichu.form).toBe("alola");
    expect(raichu.gen).toBe(7);
    expect(raichu.types).toEqual(["electric", "psychic"]);
    for (const s of roster.species.filter((x) => x.form)) {
      const d = Dex.species.get(s.calc);
      expect(s.types).toEqual(d.types.map((t) => t.toLowerCase()));
      expect(s.base).toEqual({ ...d.baseStats });
    }
    // No Gigantamax or Eternamax forms: they only exist in Dynamax battles.
    expect(roster.species.some((s) => /gmax|eternamax/.test(s.slug))).toBe(false);
  });

  it("random-battle Pokémon use their random-battle set; the rest their level-up moves at their level", () => {
    const arceus = mon("arceus");
    expect(arceus.source).toBe("randbats");
    expect(movesOf(arceus).map((m) => m.name).sort()).toEqual(["Earthquake", "Extreme Speed", "Shadow Claw"]);
    expect(arceus.ability).toBe("Multitype");
    const karp = mon("magikarp");
    expect(karp.source).toBe("learnset");
    expect(movesOf(karp).map((m) => m.name).sort()).toEqual(["Flail", "Tackle"]);
    // Magikarp learns Tackle at 15 and Flail at 30.
    expect(movesOf(karp, 10)).toEqual([]);
    expect(movesOf(karp, 20).map((m) => m.name)).toEqual(["Tackle"]);
    expect(karp.ability).toBe("Swift Swim");
    expect(karp.item).toBe("");
    // Pikachu's random-battle item is its Light Ball, held only with random-battle items on.
    expect(mon("pikachu").item).toBe("Light Ball");
    expect(fighter("pikachu").set.item).toBe("");
    expect(fighter("pikachu", undefined, 100, "sets").set.item).toBe("Light Ball");
  });

  it("no default set carries a move the battle can't play, and none has more than four", () => {
    for (const s of roster.species) {
      for (const lv of [5, 50, 100]) {
        const ms = movesOf(s, lv);
        expect(ms.length).toBeLessThanOrEqual(4);
        for (const m of ms) {
          expect(unplayable(m.name)).toBeNull();
          expect(EXCLUDED_MOVES.has(Dex.moves.get(m.name).id)).toBe(false);
        }
      }
    }
  });

  it("every move a species can legally learn is offered, and only those", () => {
    const ls = buildLearnsets();
    const names = (slug: string) => ls[mon(slug).id].map((i) => roster.moves[i].name);
    // Magikarp can only ever learn Splash, Tackle, Flail and Bounce (a two-turn move the battle leaves out).
    expect(names("magikarp").sort()).toEqual(["Flail", "Tackle"]);
    expect(names("pikachu")).toContain("Thunderbolt");
    expect(names("pikachu")).not.toContain("Psystrike");
    // A Mega learns what its species does.
    expect(names("charizard-mega-x")).toContain("Flare Blitz");
  });

  it("move rules come from Showdown's data: targets, contact, priority, hits, side effects", () => {
    expect(move("Earthquake")).toMatchObject({ spread: true, contact: false, type: "Ground" });
    expect(move("Extreme Speed")).toMatchObject({ spread: false, contact: true, pri: 2 });
    expect(move("Thunderbolt").fx).toEqual([{ chance: 10, on: "target", status: "par" }]);
    expect(move("Close Combat").fx).toEqual([{ chance: 100, on: "self", boosts: { def: -1, spd: -1 }, always: true }]);
    expect(move("Iron Head").fx).toEqual([{ chance: 30, on: "target", flinch: true }]);
    expect(move("Outrage").rampage).toBe(true);
    expect(move("High Jump Kick").crash).toBe(true);
    expect(move("Body Press").atkStat).toBe("def");
    expect(move("Foul Play").atkStat).toBe("target-atk");
    expect(move("Psyshock").hitsDef).toBe(true);
    for (const m of roster.moves) {
      const d = Dex.moves.get(m.name);
      expect(m.spread).toBe(d.target === "allAdjacent" || d.target === "allAdjacentFoes");
      expect(m.pri).toBe(d.priority);
      expect(m.contact).toBe(!!d.flags.contact);
    }
  });

  it("HP and Speed follow the games' stat formula with the set, and agree with the damage calculator", () => {
    for (const s of roster.species.filter((_, k) => k % 7 === 0)) {
      for (const [level, choice] of [[50, undefined], [100, undefined], [37, { nature: "Timid", evs: "offence" }], [5, { nature: "Brave", evs: "bulk" }]] as const) {
        const set = resolveSet(s, roster, choice as SetChoice | undefined, level, "none");
        const ours = battleStats(s, set);
        const c = calcPokemon({ species: s, set });
        expect(ours.hp).toBe(c.maxHP());
        expect(ours.spe).toBe(c.rawStats.spe);
        expect(ours.atk).toBe(c.rawStats.atk);
      }
    }
    expect(battleStat("hp", 20, 100)).toBe(202); // Magikarp
    expect(battleStat("hp", 1, 100, true)).toBe(1); // Shedinja
  });
});

describe("mass battle: the damage table is @smogon/calc", () => {
  const table = (a: string, b: string, choiceA?: SetChoice, choiceB?: SetChoice, field: BattleSpec["field"] = undefined) => {
    const fa = fighter(a, choiceA), fb = fighter(b, choiceB);
    return { fa, fb, t: new DamageTable([fa, fb], field ?? { weather: "none", terrain: "none", time: "day" }) };
  };
  const full = (t: DamageTable, a = 0, d = 1) => neutralState(t.maxHp(a), t.maxHp(d));
  const direct = (fa: Fighter, fb: Fighter, moveName: string, opts: { crit?: boolean; doubles?: boolean; weather?: string } = {}) =>
    rollsOf(calculate(gen, calcPokemon(fa), calcPokemon(fb), new Move(gen, moveName, { isCrit: opts.crit }), new Field({ gameType: opts.doubles ? "Doubles" : "Singles", weather: opts.weather as never })).damage);
  const slotOf = (f: Fighter, name: string) => f.set.moves.findIndex((m) => m.name === name);

  it("Magikarp's Tackle on Arceus: the calculator's 16 rolls", () => {
    const { fa, fb, t } = table("magikarp", "arceus");
    const slot = slotOf(fa, "Tackle");
    const e = t.entry(0, slot, 1, full(t));
    expect(Array.from(e.hits[0])).toEqual(Array.from(direct(fa, fb, "Tackle")[0]));
    expect(e.hits[0][0]).toBe(8);
    expect(e.hits[0][15]).toBe(10);
    const c = t.entry(0, slot, 1, { ...full(t), crit: true });
    expect(Array.from(c.hits[0])).toEqual(Array.from(direct(fa, fb, "Tackle", { crit: true })[0]));
  });

  it("Mewtwo's Psystrike on Rattata, and Earthquake's spread damage (the doubles 0.75)", () => {
    const m = table("mewtwo", "rattata");
    expect(Array.from(m.t.entry(0, slotOf(m.fa, "Psystrike"), 1, full(m.t)).hits[0])).toEqual(Array.from(direct(m.fa, m.fb, "Psystrike")[0]));
    const a = table("arceus", "magikarp");
    const eq = slotOf(a.fa, "Earthquake");
    const single = a.t.entry(0, eq, 1, full(a.t));
    const spread = a.t.entry(0, eq, 1, { ...full(a.t), spread: true });
    expect(Array.from(spread.hits[0])).toEqual(Array.from(direct(a.fa, a.fb, "Earthquake", { doubles: true })[0]));
    expect(spread.avg).toBeLessThan(single.avg * 0.8);
  });

  it("Huge Power doubles Azumarill's damage; Levitate makes Earthquake miss entirely", () => {
    const huge = table("azumarill", "arceus");
    const thick = table("azumarill", "arceus", { ability: "Thick Fat" });
    const liq = slotOf(huge.fa, "Liquidation");
    expect(huge.fa.set.ability).toBe("Huge Power");
    expect(huge.t.entry(0, liq, 1, full(huge.t)).avg).toBeGreaterThan(thick.t.entry(0, liq, 1, full(thick.t)).avg * 1.8);
    const lev = table("arceus", "bronzong");
    expect(lev.fb.set.ability).toBe("Levitate");
    expect(lev.t.entry(0, slotOf(lev.fa, "Earthquake"), 1, full(lev.t)).immune).toBe(true);
    expect(lev.t.canDamage(0, 1)).toBe(true); // Extreme Speed and Shadow Claw still land
  });

  it("stat stages, a burn, a lost item and Tera all change the hit as the calculator says", () => {
    const { fa, t } = table("machamp", "snorlax");
    // A physical move with a base power (Seismic Toss does its level whatever the stats).
    const s = fa.set.moves.findIndex((m) => m.cat === "Physical" && m.bp > 0);
    const base = t.entry(0, s, 1, full(t)).avg;
    expect(t.entry(0, s, 1, { ...full(t), aStage: 2 }).avg).toBeGreaterThan(base * 1.8);
    expect(t.entry(0, s, 1, { ...full(t), dStage: -1 }).avg).toBeGreaterThan(base * 1.3);
    // Machamp has Guts by default: a burn raises its damage instead of halving it.
    expect(fa.set.ability).toBe("Guts");
    expect(t.entry(0, s, 1, { ...full(t), aStatus: STATUS.brn }).avg).toBeGreaterThan(base * 1.3);
    const noGuts = table("machamp", "snorlax", { ability: "No Guard" });
    expect(noGuts.t.entry(0, s, 1, { ...full(noGuts.t), aStatus: STATUS.brn }).avg).toBeLessThan(noGuts.t.entry(0, s, 1, full(noGuts.t)).avg * 0.6);
    // Tera Water: Azumarill loses its Fairy type, so Sludge Bomb is no longer super effective on it.
    const fairy = table("vileplume", "azumarill"), water = table("vileplume", "azumarill", undefined, { tera: "Water" });
    const sb = slotOf(fairy.fa, "Sludge Bomb");
    expect(water.t.entry(0, sb, 1, full(water.t)).avg).toBeLessThan(fairy.t.entry(0, sb, 1, full(fairy.t)).avg * 0.6);
  });

  it("weather through the calculator: rain boosts Water moves and weakens Fire ones", () => {
    const dry = table("blastoise", "charizard");
    const wet = table("blastoise", "charizard", undefined, undefined, { weather: "rain", terrain: "none", time: "day" });
    const water = dry.fa.set.moves.findIndex((m) => m.type === "Water");
    expect(wet.t.entry(0, water, 1, full(wet.t)).avg).toBeGreaterThan(dry.t.entry(0, water, 1, full(dry.t)).avg * 1.4);
    expect(Array.from(wet.t.entry(0, water, 1, full(wet.t)).hits[0])).toEqual(Array.from(direct(wet.fa, wet.fb, wet.fa.set.moves[water].name, { weather: "Rain" })[0]));
  });

  it("Flail's power follows the attacker's HP, as in the games", () => {
    const { fa, t } = table("magikarp", "arceus");
    const flail = slotOf(fa, "Flail");
    const fullHp = t.entry(0, flail, 1, full(t)).avg;
    const low = t.entry(0, flail, 1, { ...full(t), aHp: 3 }).avg; // under 1/48: 200 power
    expect(low).toBeGreaterThan(fullHp * 8);
    expect(t.maxHp(0)).toBe(202);
  });

  it("agrees with the battle CPU's memoised hit() on expected damage", () => {
    const { fa, fb, t } = table("arceus", "mewtwo");
    const a = calcPokemon(fa), d = calcPokemon(fb);
    withCalcMemo(() => {
      fa.set.moves.forEach((m, slot) => {
        const h = hit(gen, a, d, m.name, new Field({ gameType: "Singles" }));
        const e = t.entry(0, slot, 1, full(t));
        const lo = e.hits[0][0], hi = e.hits[0][15];
        const acc = m.acc ? m.acc / 100 : 1;
        expect(h.frac).toBeCloseTo(Math.min(1, (lo + hi) / 2 / t.maxHp(1)) * acc, 6);
      });
    });
  });
});

/** A battle with chosen fighters and moves, every unit in reach of every other (the simulator check's layout). */
function melee(units: { slug: string; side: 0 | 1; moves: string[]; set?: SetChoice }[], seed = 9, field: BattleSpec["field"] = undefined): Battle {
  const prep: Prepared = {
    species: units.map((u) => mon(u.slug)),
    sets: units.map((u) => ({ ...resolveSet(mon(u.slug), roster, u.set, 100, "none"), moves: u.moves.map(move) })),
    moves: units.map((u) => u.moves.map(move)),
    level: 100,
    armies: [units.flatMap((u, i) => (u.side === 0 ? [[i, 1] as [number, number]] : [])), units.flatMap((u, i) => (u.side === 1 ? [[i, 1] as [number, number]] : []))],
    formations: ["line", "line"],
    behaviour: [{ spacing: "normal", targeting: "nearest", stance: "charge", spread: "auto" }, { spacing: "normal", targeting: "nearest", stance: "charge", spread: "auto" }],
    field: field ?? { weather: "none", terrain: "none", time: "day" },
    seed,
    layout: "melee",
  };
  return new Battle(prep);
}

function firstRoundActors(b: Battle): number[] {
  const seen: number[] = [];
  for (let t = 0; t < 60 && !b.ended; t++) {
    b.step();
    for (let k = 0; k < b.eventCount; k++) {
      const actor = b.events[k * EVENT_INTS];
      if (b.events[k * EVENT_INTS + 2] >= 0 && !seen.includes(actor)) seen.push(actor);
    }
  }
  return seen;
}

/** Plays a battle to the end collecting its notes. */
function notesOf(b: Battle): { unit: number; kind: number; value: number }[] {
  const out: { unit: number; kind: number; value: number }[] = [];
  while (!b.ended) {
    b.step();
    for (let k = 0; k < b.noteCount; k++) out.push({ unit: b.notes[k * NOTE_INTS], kind: b.notes[k * NOTE_INTS + 1], value: b.notes[k * NOTE_INTS + 2] });
  }
  return out;
}

describe("mass battle: rounds", () => {
  it("priority moves go first, whatever the Speed", () => {
    const b = melee([{ slug: "snorlax", side: 0, moves: ["Extreme Speed"] }, { slug: "mewtwo", side: 1, moves: ["Psystrike"] }]);
    expect(firstRoundActors(b)).toEqual([0, 1]);
  });

  it("without priority, the faster Pokémon acts first; paralysis halves Speed", () => {
    expect(firstRoundActors(melee([{ slug: "snorlax", side: 0, moves: ["Body Slam"] }, { slug: "mewtwo", side: 1, moves: ["Psystrike"] }]))).toEqual([1, 0]);
    expect(firstRoundActors(melee([{ slug: "jolteon", side: 0, moves: ["Thunderbolt"] }, { slug: "snorlax", side: 1, moves: ["Body Slam"] }]))).toEqual([0, 1]);
    const b = melee([{ slug: "mewtwo", side: 0, moves: ["Psystrike"] }, { slug: "rattata", side: 1, moves: ["Tackle"] }]);
    const fast = b.effectiveSpeed(0);
    b.status[0] = STATUS.par;
    expect(b.effectiveSpeed(0)).toBe(Math.floor(fast * 0.5));
  });

  it("a fainted Pokémon doesn't act", () => {
    const b = melee([{ slug: "rattata", side: 0, moves: ["Tackle"] }, { slug: "mewtwo", side: 1, moves: ["Psystrike"] }]);
    expect(firstRoundActors(b)).toEqual([1]);
    expect(b.alive[0]).toBe(0);
  });
});

describe("mass battle: status, stat stages and the rest of the games' rules", () => {
  it("Electric types can't be paralysed; a paralysed foe sometimes can't move", () => {
    let paralysed = 0, skipped = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const notes = notesOf(melee([{ slug: "jolteon", side: 0, moves: ["Zap Cannon"] }, { slug: "snorlax", side: 1, moves: ["Body Slam"] }], seed));
      if (notes.some((n) => n.kind === NOTE.STATUS && n.value === STATUS.par && n.unit === 1)) paralysed++;
      if (notes.some((n) => n.kind === NOTE.SKIP && n.unit === 1)) skipped++;
      expect(notes.some((n) => n.kind === NOTE.STATUS && n.unit === 0)).toBe(false); // Body Slam never paralyses Jolteon
    }
    expect(paralysed).toBeGreaterThan(10);
    expect(skipped).toBeGreaterThan(0);
  });

  it("Close Combat lowers the user's defences; Moxie raises Attack with every KO", () => {
    const b = melee([{ slug: "machamp", side: 0, moves: ["Close Combat"] }, { slug: "snorlax", side: 1, moves: ["Body Slam"] }]);
    for (let t = 0; t < 60; t++) b.step();
    expect(b.stages[1]).toBe(-1); // Defense
    expect(b.stages[3]).toBe(-1); // Sp. Def
    const m = melee([{ slug: "krookodile", side: 0, moves: ["Earthquake"], set: { ability: "Moxie" } }, { slug: "magikarp", side: 1, moves: ["Tackle"] }, { slug: "magikarp", side: 1, moves: ["Tackle"] }]);
    while (!m.ended) m.step();
    expect(m.stages[0]).toBe(2);
  });

  it("Outrage locks its user in and then confuses it", () => {
    let confused = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const notes = notesOf(melee([{ slug: "dragonite", side: 0, moves: ["Outrage"], set: { ability: "Inner Focus" } }, { slug: "snorlax", side: 1, moves: ["Body Slam"], set: { evs: "bulk" } }], seed));
      if (notes.some((n) => n.kind === NOTE.STATUS && n.value === 9 && n.unit === 0)) confused++;
    }
    expect(confused).toBeGreaterThan(5);
  });

  it("Static paralyses attackers that touch it; Rough Skin and Rocky Helmet hurt them", () => {
    let para = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const notes = notesOf(melee([{ slug: "pikachu", side: 0, moves: ["Thunderbolt"], set: { ability: "Static" } }, { slug: "snorlax", side: 1, moves: ["Body Slam"] }], seed));
      if (notes.some((n) => n.kind === NOTE.STATUS && n.unit === 1)) para++;
    }
    expect(para).toBeGreaterThan(5);
    // Machamp's Close Combat on a Garchomp (Rough Skin) holding a Rocky Helmet: 1/8 and 1/6 of Machamp's HP come back at it.
    const b = melee([{ slug: "machamp", side: 0, moves: ["Close Combat"] }, { slug: "garchomp", side: 1, moves: ["Dragon Claw"], set: { item: "Rocky Helmet" } }]);
    const chips: number[] = [];
    for (let t = 0; t < 60; t++) {
      b.step();
      for (let k = 0; k < b.noteCount; k++) if (b.notes[k * NOTE_INTS] === 0 && b.notes[k * NOTE_INTS + 1] === NOTE.CHIP) chips.push(b.notes[k * NOTE_INTS + 2]);
    }
    const max = b.rows[0].maxHp;
    expect(chips).toEqual([Math.floor(max / 8), Math.floor(max / 6)]);
  });

  it("a miss with High Jump Kick costs half the user's HP", () => {
    let crashes = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const b = melee([{ slug: "hitmonlee", side: 0, moves: ["High Jump Kick"] }, { slug: "snorlax", side: 1, moves: ["Body Slam"], set: { item: "Bright Powder" } }], seed);
      for (let t = 0; t < 60 && !b.ended; t++) {
        b.step();
        let missed = false;
        for (let k = 0; k < b.eventCount; k++) if (b.events[k * EVENT_INTS] === 0 && b.events[k * EVENT_INTS + 4] & EV.MISS) missed = true;
        if (missed) {
          crashes++;
          const chip = Array.from({ length: b.noteCount }, (_, k) => k).some((k) => b.notes[k * NOTE_INTS] === 0 && b.notes[k * NOTE_INTS + 1] === NOTE.CHIP && b.notes[k * NOTE_INTS + 2] === Math.floor(b.rows[0].maxHp / 2));
          expect(chip).toBe(true);
        }
      }
    }
    expect(crashes).toBeGreaterThan(3);
  });

  it("items: Leftovers heals each round, Focus Sash survives a KO once, Knock Off takes an item", () => {
    const left = melee([{ slug: "snorlax", side: 0, moves: ["Tackle"], set: { item: "Leftovers" } }, { slug: "blissey", side: 1, moves: ["Seismic Toss"] }]);
    const heals = notesOf(left).filter((n) => n.kind === NOTE.HEAL && n.unit === 0);
    expect(heals.length).toBeGreaterThan(2);
    expect(heals[0].value).toBe(Math.floor(left.rows[0].maxHp / 16));
    const sash = melee([{ slug: "mewtwo", side: 0, moves: ["Psystrike"] }, { slug: "rattata", side: 1, moves: ["Tackle"], set: { item: "Focus Sash" } }]);
    for (let t = 0; t < 60; t++) sash.step();
    expect(sash.alive[1]).toBe(1);
    expect(sash.itemGone[1]).toBe(1);
    const knock = melee([{ slug: "tyranitar", side: 0, moves: ["Knock Off"] }, { slug: "snorlax", side: 1, moves: ["Body Slam"], set: { item: "Leftovers" } }]);
    for (let t = 0; t < 60; t++) knock.step();
    expect(knock.itemGone[1]).toBe(1);
  });

  it("the field: sandstorm chips at the end of each round, Psychic Terrain stops priority, Thunder never misses in rain", () => {
    const sand = melee([{ slug: "pikachu", side: 0, moves: ["Tackle"] }, { slug: "tyranitar", side: 1, moves: ["Tackle"] }], 3, { weather: "sand", terrain: "none", time: "day" });
    const chip = notesOf(sand).filter((n) => n.kind === NOTE.CHIP);
    expect(chip.some((n) => n.unit === 0 && n.value === Math.floor(sand.rows[0].maxHp / 16))).toBe(true);
    expect(chip.some((n) => n.unit === 1)).toBe(false); // Rock types don't mind sand
    const psy = melee([{ slug: "dragonite", side: 0, moves: ["Extreme Speed"] }, { slug: "snorlax", side: 1, moves: ["Body Slam"] }], 3, { weather: "none", terrain: "psychic", time: "day" });
    for (let t = 0; t < 60; t++) psy.step();
    expect(psy.hp[1]).toBe(psy.rows[1].maxHp);
    let misses = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const b = melee([{ slug: "zapdos", side: 0, moves: ["Thunder"] }, { slug: "blissey", side: 1, moves: ["Seismic Toss"] }], seed, { weather: "rain", terrain: "none", time: "day" });
      for (let t = 0; t < 60; t++) b.step();
      for (let k = 0; k < b.eventCount; k++) if (b.events[k * EVENT_INTS + 4] & EV.MISS) misses++;
    }
    expect(misses).toBe(0);
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
    expect(trace(43).h).not.toBe(a.h);
  });

  it("battles end with a winner, and 1 Mewtwo beats 1 Rattata", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const b = runHeadless(prepare(roster, spec([["rattata", 1]], [["mewtwo", 1]], seed)));
      expect(b.ended).toBe(true);
      expect(b.winner).toBe(1);
    }
  });

  it("an army that can't hurt the other side at all makes a draw (Normal moves against Gengar's Ghost type both ways)", () => {
    const b = melee([{ slug: "snorlax", side: 0, moves: ["Body Slam"] }, { slug: "gengar", side: 1, moves: ["Shadow Ball"] }], 3);
    while (!b.ended) b.step();
    expect(b.winner).toBe(2);
    expect(b.seconds).toBeLessThan(5);
  });
});

describe("mass battle: neighbours and behaviour", () => {
  it("each unit's foe is the nearest one it can hurt", () => {
    const b = new Battle(prepare(roster, spec([["rattata", 300], ["pidgey", 100]], [["magikarp", 250], ["gastly", 50]], 5)));
    for (let t = 0; t < 70; t++) b.step();
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
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("focus the boss: every unit goes for the other side's biggest threat; holding the line waits", () => {
    const s = spec([["rattata", 200]], [["magikarp", 50], ["mewtwo", 1]], 2);
    s.sides[0].targeting = "boss";
    const b = new Battle(prepare(roster, s));
    const mewtwo = Array.from({ length: b.n }, (_, i) => i).find((i) => b.prep.species[b.sp[i]].slug === "mewtwo")!;
    for (let i = 0; i < b.n; i++) if (b.side[i] === 0) expect(b.target[i]).toBe(mewtwo);
    const hold = spec([["rattata", 50]], [["pidgey", 50]], 2);
    hold.sides[0].stance = "hold";
    hold.sides[1].stance = "hold";
    const h = new Battle(prepare(roster, hold));
    const x0 = Array.from(h.x);
    for (let t = 0; t < 60; t++) h.step();
    const moved = Array.from(h.x).reduce((m, x, i) => Math.max(m, Math.abs(x - x0[i])), 0);
    expect(moved).toBeLessThan(1);
    // Nobody acting for six seconds: they advance after all.
    for (let t = 0; t < 120; t++) h.step();
    expect(Array.from(h.x).reduce((m, x, i) => Math.max(m, Math.abs(x - x0[i])), 0)).toBeGreaterThan(3);
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
  it("finds the smallest army that wins half its battles (or nine in ten), on a known curve", async () => {
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
    const r = await solve("curve", evaluate, (s) => tried.push(s.n));
    expect(r.answer).not.toBeNull();
    expect(Math.abs(r.answer! - 137)).toBeLessThanOrEqual(8);
    expect(r.wins * 2).toBeGreaterThanOrEqual(r.runs);
    expect(r.wonSeed).not.toBeNull();
    const below = await evaluate(r.answer! - 1, questionSeeds("curve"), () => false);
    expect(below.wins * 2).toBeLessThan(below.runs + 8);
    expect(tried[0]).toBe(1);
    // Nine in ten needs more: about 137 + 4·ln 9 ≈ 146.
    const r90 = await solve("curve", evaluate, undefined, { threshold: 0.9, runs: 100 });
    expect(r90.answer!).toBeGreaterThan(r.answer!);
    expect(r90.wins).toBeGreaterThanOrEqual(winsNeeded(100, 0.9));
  });

  it("says so when no army up to the cap wins", async () => {
    const r = await solve("never", async (_n, seeds) => ({ wins: 0, runs: seeds.length, wonSeeds: [], lostSeeds: seeds }), undefined, { maxN: 64 });
    expect(r.answer).toBeNull();
    expect(r.none).toBe("above-cap");
  });

  it("runs real battles: 1 Mewtwo beats 1 Rattata, so it takes more than one", async () => {
    const q = simpleQuestion(mon("rattata").id, mon("mewtwo").id);
    const evaluate: Evaluate = async (n, seeds, settled) => {
      let wins = 0, losses = 0;
      const wonSeeds: number[] = [], lostSeeds: number[] = [];
      for (const seed of seeds) {
        const b = runHeadless(prepare(roster, questionSpec(q, n, seed)));
        if (b.winner === 0) { wins++; wonSeeds.push(seed); } else { losses++; lostSeeds.push(seed); }
        if (settled(wins, losses)) break;
      }
      return { wins, runs: wins + losses, wonSeeds, lostSeeds };
    };
    const r = await solve(questionKey(q, slugs), evaluate);
    expect(r.answer).toBeGreaterThan(1);
    expect(r.answer).toBeLessThan(80);
  });

  it("monotone rates and the spread", () => {
    expect(monotone([{ n: 1, wins: 0, runs: 10 }, { n: 2, wins: 6, runs: 10 }, { n: 3, wins: 4, runs: 10 }, { n: 4, wins: 10, runs: 10 }]).map((p) => p.rate)).toEqual([0, 0.5, 0.5, 1]);
    expect(spreadOf([{ n: 80, wins: 0, runs: 40 }, { n: 90, wins: 10, runs: 40 }, { n: 100, wins: 20, runs: 40 }, { n: 110, wins: 30, runs: 40 }, { n: 120, wins: 40, runs: 40 }])).toBe(10);
    expect(probesAround(3)).toEqual([1, 2, 4, 5]);
    expect(probesAround(100)).toEqual([80, 90, 110, 120]);
    expect(questionSeeds("x")).toEqual(questionSeeds("x"));
    expect(questionSeeds("x", 100).slice(0, 40)).toEqual(questionSeeds("x", 40));
    expect(winsNeeded(40, 0.5)).toBe(20);
    expect(winsNeeded(40, 0.9)).toBe(36);
  });

  it("a question's army shares its size between its rows", () => {
    const q: Question = { army: { formation: "swarm", units: [{ id: mon("charmander").id, count: 1 }, { id: mon("squirtle").id, count: 1 }, { id: mon("bulbasaur").id, count: 1 }] }, boss: { formation: "line", units: [{ id: mon("mewtwo").id, count: 1 }] }, level: 50, arena: "plains" };
    expect(questionSpec(q, 10, 1).sides[0].units.map((u) => u.count)).toEqual([4, 3, 3]);
    expect(questionSpec(q, 2, 1).sides[0].units.map((u) => u.count)).toEqual([1, 1]);
  });
});

describe("mass battle: share links", () => {
  it("round-trips a battle with sets, groups, the field and how each side fights", () => {
    const s: BattleSpec = {
      sides: [
        { units: [{ id: mon("magikarp").id, count: 60, set: { level: 30, moves: ["flail"], item: "Life Orb", nature: "Adamant", evs: "offence", tera: "Water" } }, { id: 0, count: 5, group: { types: ["fire"], fullyEvolved: true, legendary: "no" } }], formation: "swarm", spacing: "loose", targeting: "boss", stance: "hold", spread: "never" },
        { units: [{ id: mon("arceus").id, count: 1, set: { ability: "multitype", item: "" } }], formation: "line" },
      ],
      level: 50,
      arena: "colosseum",
      seed: 123456,
      field: { weather: "rain", terrain: "grassy", time: "dusk" },
      items: "sets",
    };
    const code = encodeBattle(s, slugs);
    expect(code).toBe(`2.50.colosseum.${(123456).toString(36)}.rain-grassy-dusk-items.swarm-loose-boss-hold-single_magikarp*60*l30*mflail*ilifeorb*nadamant*eo*twater_all-fire-nolegend-fe*5.line_arceus*1*amultitype*i0`);
    expect(new URLSearchParams({ b: code }).toString()).toBe(`b=${code}`);
    expect(decodeBattle(code, slugs)).toEqual({ ...s, sides: [{ ...s.sides[0], units: [{ ...s.sides[0].units[0], set: { ...s.sides[0].units[0].set, moves: ["flail"], item: "Life Orb", nature: "adamant", tera: "Water" } }, s.sides[0].units[1]] }, s.sides[1]] });
    const plain: BattleSpec = { sides: [{ units: [{ id: 19, count: 1000 }], formation: "swarm" }, { units: [{ id: 150, count: 1 }], formation: "line" }], level: 100, arena: "plains", seed: 7 };
    expect(encodeBattle(plain, slugs)).toBe("2.100.plains.7.0.swarm_rattata*1000.line_mewtwo*1");
    expect(decodeBattle(encodeBattle(plain, slugs), slugs)).toEqual(plain);
    // A form by its slug.
    const form: BattleSpec = { ...plain, sides: [{ units: [{ id: mon("raichu-alola").id, count: 3 }], formation: "line" }, plain.sides[1]] };
    expect(decodeBattle(encodeBattle(form, slugs), slugs)).toEqual(form);
  });

  it("still opens version 1 links (with the random-battle items they had)", () => {
    const v1 = decodeBattle(`1.100.plains.${(123456).toString(36)}.swarm.line.rattata*1000.mewtwo*1`, slugs)!;
    expect(v1).toEqual({ sides: [{ units: [{ id: 19, count: 1000 }], formation: "swarm" }, { units: [{ id: 150, count: 1 }], formation: "line" }], level: 100, arena: "plains", seed: 123456, items: "sets" });
    expect(decodeQuestion("magikarp.arceus.50.volcano", slugs)).toEqual(simpleQuestion(129, 493, 50, "volcano"));
  });

  it("round-trips a question, with its solver settings, and keys its battles by what decides them", () => {
    const q: Question = { army: { formation: "swarm", units: [{ id: mon("magikarp").id, count: 1 }, { id: 0, count: 1, group: { types: ["water", "flying"] } }] }, boss: { formation: "line", units: [{ id: mon("arceus").id, count: 2 }] }, level: 100, arena: "colosseum", threshold: 0.9, runs: 100, field: { weather: "sun", terrain: "none", time: "day" } };
    const code = encodeQuestion(q, slugs);
    expect(code).toBe("2.100.colosseum.90-100.sun.swarm_magikarp*1_all-water-flying*1.line_arceus*2");
    expect(decodeQuestion(code, slugs)).toEqual(q);
    expect(questionKey(q, slugs)).toBe(questionKey({ ...q, runs: 20 }, slugs));
    expect(questionKey(q, slugs)).not.toBe(questionKey({ ...q, level: 50 }, slugs));
    expect(encodeQuestion(simpleQuestion(129, 493, 100, "colosseum"), slugs)).toBe("2.100.colosseum.50-40.0.swarm_magikarp*1.line_arceus*1");
  });

  it("encodes how the battle is shown", () => {
    const p = { speed: 0.25, slowmo: false, numbers: true, hud: false, camera: "top" as const };
    expect(encodePlayback(p)).toBe("0.25-top-numbers-nohud-noslow");
    expect(decodePlayback(encodePlayback(p))).toEqual(p);
    expect(encodePlayback(decodePlayback(null))).toBe("");
  });

  it("refuses broken links and caps the army size", () => {
    for (const bad of ["", "3.100.plains.1.0.swarm_rattata*1.line_mewtwo*1", "2.100.moon.1.0.swarm_rattata*1.line_mewtwo*1", "2.100.plains.1.hail.swarm_rattata*1.line_mewtwo*1", "2.100.plains.1.0.blob_rattata*1.line_mewtwo*1", "2.100.plains.1.0.swarm_notamon*1.line_mewtwo*1", "2.100.plains.1.0.swarm_rattata.line_mewtwo*1", "2.100.plains.1.0.swarm.line_mewtwo*1", "2.100.plains.1.0.swarm_all-sometype*3.line_mewtwo*1", "1.70.plains.1.swarm.line.rattata*1.mewtwo*1"]) {
      expect(decodeBattle(bad, slugs), bad).toBeNull();
    }
    const big = decodeBattle("2.100.plains.1.0.swarm_rattata*999999.line_mewtwo*1", slugs)!;
    expect(big.sides[0].units[0].count).toBe(MAX_SIDE);
    // Five rows is one too many for a hand-made side.
    expect(decodeBattle("2.100.plains.1.0.swarm_rattata*1_pidgey*1_magikarp*1_zubat*1_geodude*1.line_mewtwo*1", slugs, 4)).toBeNull();
    expect(decodeQuestion("magikarp.nobody", slugs)).toBeNull();
    // Levels are clamped to 1–100.
    expect(decodeBattle("2.250.plains.1.0.swarm_rattata*1.line_mewtwo*1", slugs)!.level).toBe(100);
  });
});

describe("mass battle: the setup panel's state", () => {
  const id = (slug: string) => mon(slug).id;
  it("a battle and a question survive the panel both ways", () => {
    const base = defaultSetup(id);
    const s: BattleSpec = { sides: [{ units: [{ id: id("pikachu"), count: 50, set: { level: 40 } }, { id: 0, count: 3, group: { gen: 1, fullyEvolved: true } }], formation: "wedge", targeting: "weakest" }, { units: [{ id: id("snorlax"), count: 2 }], formation: "line", stance: "hold" }], level: 77, arena: "volcano", seed: 9, field: { weather: "snow", terrain: "misty", time: "night" }, items: "sets" };
    expect(toBattle(fromBattle(base, s), 9)).toEqual(s);
    const q: Question = { army: { formation: "swarm", units: [{ id: id("magikarp"), count: 1 }], spacing: "tight" }, boss: { formation: "line", units: [{ id: id("arceus"), count: 1, set: { tera: "Ghost" } }] }, level: 100, arena: "colosseum", threshold: 0.9, runs: 200 };
    expect(toQuestion(fromQuestion(base, q))).toEqual(q);
    expect(toQuestion(base)).toEqual(simpleQuestion(id("magikarp"), id("arceus")));
  });
});

describe("mass battle: groups", () => {
  const facts = roster.species.map(factsOf);
  it("filters by type, a type pair, generation, legendaries and mythicals, fully evolved (default and regional forms, no Megas)", () => {
    const fire = groupMembers(facts, { types: ["fire"], fullyEvolved: true, legendary: "no" });
    const names = new Set(fire.map((f) => roster.species.find((s) => s.id === f.id)!.slug));
    expect(names.has("charizard")).toBe(true);
    expect(names.has("marowak-alola")).toBe(true);
    expect(names.has("charmander")).toBe(false);
    expect(names.has("charizard-mega-x")).toBe(false);
    expect(names.has("moltres")).toBe(false);
    const pair = groupMembers(facts, { types: ["water", "flying"] }).map((f) => roster.species.find((s) => s.id === f.id)!.slug);
    expect(pair).toContain("gyarados");
    expect(pair.every((slug) => mon(slug).types.includes("water") && mon(slug).types.includes("flying"))).toBe(true);
    const myth = groupMembers(facts, { mythical: true });
    expect(myth.every((f) => f.mythical)).toBe(true);
    expect(myth.some((f) => f.id === 151)).toBe(true);
    const both = groupMembers(facts, { legendary: true, mythical: true });
    expect(both.length).toBe(groupMembers(facts, { legendary: true }).length + myth.length);
    expect(groupMembers(facts, { gen: 7, types: ["electric"] }).some((f) => f.id === mon("raichu-alola").id)).toBe(true);
    expect(matchesGroup(factsOf(mon("metapod")), {})).toBe(false); // nothing to attack with
    expect(groupLabel({ types: ["fire"], fullyEvolved: true, legendary: "no" })).toBe("Every fully evolved Fire type, no legendaries");
  });

  it("a group spells out into its species, each with the group's count and set", () => {
    const s: BattleSpec = { sides: [{ units: [{ id: 0, count: 4, group: { types: ["fire"], fullyEvolved: true, legendary: "no" }, set: { level: 50 } }], formation: "line" }, { units: [{ id: mon("blastoise").id, count: 1 }], formation: "line" }], level: 100, arena: "plains", seed: 1 };
    const x = expandSpec(s, facts);
    expect(x.sides[0].units.length).toBeGreaterThan(20);
    expect(x.sides[0].units.every((u) => u.count === 4 && u.set?.level === 50 && !u.group)).toBe(true);
    const prep = prepare(roster, s);
    expect(prep.armies[0].reduce((a, [, c]) => a + c, 0)).toBe(x.sides[0].units.length * 4);
    expect(prep.sets.slice(0, -1).every((set) => set.level === 50)).toBe(true);
  });
});

describe("mass battle: presets", () => {
  it("every preset resolves to real armies", () => {
    const facts = roster.species.map(factsOf);
    for (const p of PRESETS) {
      const r = resolvePreset(p, roster);
      for (const side of expandSpec(r.spec, facts).sides) {
        expect(side.units.length).toBeGreaterThan(0);
        for (const u of side.units) expect(roster.species.some((s) => s.id === u.id && (s.randbats || s.levelUp.length))).toBe(true);
      }
      if (p.question) expect(r.question).not.toBeNull();
    }
    const fw = expandSpec(resolvePreset(PRESETS.find((p) => p.id === "fire-vs-water")!, roster).spec, facts);
    const types = (id: number) => roster.species.find((s) => s.id === id)!.types;
    // Water on the blue side, Fire on the red.
    expect(fw.sides[0].units.every((u) => types(u.id).includes("water") && !types(u.id).includes("fire"))).toBe(true);
    expect(fw.sides[1].units.every((u) => types(u.id).includes("fire") && !types(u.id).includes("water"))).toBe(true);
  });
});

describe("mass battle: events", () => {
  it("every KO is a hit, recoil or chip that took the last HP, and HP never goes below zero", () => {
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

describe("mass battle: the simulator check", () => {
  it("the engine and Showdown's simulator agree on a close fight (the same 200 battles every run)", () => {
    const m = MATCHUPS.find((x) => x.id === "charizard-armarouge")!;
    const r = crossCheck(m, 50, 200);
    expect(Math.abs(r.z)).toBeLessThan(2);
    expect(r.engine.wins).toBeGreaterThan(100);
    expect(r.sim.wins).toBeGreaterThan(100);
  }, 60_000);

  it("its statistics", () => {
    const [lo, hi] = wilson(50, 100);
    expect(lo).toBeCloseTo(0.404, 2);
    expect(hi).toBeCloseTo(0.596, 2);
    expect(zScore(50, 100, 50, 100)).toBe(0);
    expect(Math.abs(zScore(60, 100, 40, 100))).toBeGreaterThan(2);
    void evSpread;
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
      const prep = prepare(roster, r.spec);
      const units = prep.armies.flat().reduce((a, [, c]) => a + c, 0);
      if (units <= 1100) expect(runHeadless(prep).outcome(), p.id).toEqual(saved.outcome);
      if (p.kind === "howmany") {
        expect(saved.answer, p.id).not.toBeNull();
        // The battle the page shows at the answer is one the army wins.
        const shown = runHeadless(prepare(roster, questionSpec(r.question!, saved.answer!.n, saved.answer!.seed)));
        expect(shown.winner).toBe(0);
      }
    }
  }, 120_000);
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

  it("in a tall frame (videos, phones) both armies sit between the titles and the controls", () => {
    const army = (cx: number, alive: number, h: number, extent: number): ArmySummary => ({ alive, start: alive, cx, cz: 0, extent, fx: cx > 0 ? cx - extent : cx + extent, fz: 0, h });
    const fields: FieldSummary[] = [
      { t: 0, phase: "deploy", armies: [army(-21, 53, 0.9, 5), army(21, 1, 3.2, 1)], boss: { x: 21, z: 0, h: 3.2, side: 1 }, arena: 60, aspect: 1080 / 1920 },
      { t: 0, phase: "deploy", armies: [army(-25, 1000, 0.4, 12), army(25, 1, 2, 1)], boss: { x: 25, z: 0, h: 2, side: 1 }, arena: 70, aspect: 390 / 555 },
      { t: 0, phase: "deploy", armies: [army(-30, 365, 1.5, 15), army(30, 360, 1.6, 15)], boss: null, arena: 80, aspect: 1080 / 1920 },
    ];
    for (const field of fields) {
      const d = new Director();
      d.reset(field);
      for (let i = 0; i < 600; i++) {
        const p = d.update(field, 0.1);
        if (i < 30) continue;
        const cp = Math.cos(p.pitch);
        const cam = [p.tx + Math.sin(p.yaw) * cp * p.dist, p.ty + Math.sin(p.pitch) * p.dist, p.tz + Math.cos(p.yaw) * cp * p.dist];
        const halfV = (p.fov / 2) * (Math.PI / 180);
        const halfH = Math.atan(Math.tan(halfV) * field.aspect);
        const fwdYaw = Math.atan2(p.tx - cam[0], p.tz - cam[2]);
        const fwdPitch = Math.atan2(p.ty - cam[1], Math.hypot(p.tx - cam[0], p.tz - cam[2]));
        for (const a of field.armies) {
          const dx = a.cx - cam[0], dy = a.h / 2 - cam[1], dz = a.cz - cam[2];
          let h = Math.atan2(dx, dz) - fwdYaw;
          h = Math.atan2(Math.sin(h), Math.cos(h));
          const v = Math.atan2(dy, Math.hypot(dx, dz)) - fwdPitch;
          expect(Math.abs(h)).toBeLessThan(halfH * 0.9);
          // Below the titles (the top two fifths) and above the controls (the bottom seventh).
          expect(v / halfV).toBeLessThan(0.2);
          expect(v / halfV).toBeGreaterThan(-0.7);
        }
      }
    }
  });
});
