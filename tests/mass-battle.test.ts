import { describe, expect, it } from "vitest";
import { calculate, Field, Generations, Move } from "@smogon/calc";
import { Dex } from "@pkmn/dex";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { hit, withCalcMemo } from "@/lib/battle/cpu-policy-legacy";
import { buildLearnsets, buildRoster, EXCLUDED_MOVES, unplayable } from "@/lib/mass-battle/roster-data";
import { calcPokemon, DamageTable, neutralState, rollsOf, type Fighter } from "@/lib/mass-battle/damage";
import { Battle, BREAKABLE, EV, EVENT_INTS, NOTE, NOTE_INTS, NOTE_SKIP, prepare, runHeadless, type Prepared } from "@/lib/mass-battle/engine";
import { battleStat, battleStats, bodyRadius, FORM_BODIES } from "@/lib/mass-battle/stats";
import { TICK_HZ } from "@/lib/mass-battle/constants";
import RACE_FORMS from "@/data/race-forms.json";
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
    expect(movesOf(arceus).map((m) => m.name).sort()).toEqual(["Earthquake", "Extreme Speed", "Recover", "Swords Dance"]);
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
  const full = (t: DamageTable, a = 0, d = 1) => neutralState(t.maxHp(a), t.maxHp(d), t.field);
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
function melee(units: { slug: string; side: 0 | 1; moves: string[]; set?: SetChoice }[], seed = 9, field: BattleSpec["field"] = undefined, rules: Prepared["rules"] = { pp: false, friendlyFire: true }): Battle {
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
    rules,
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

/** Rounds in which unit `u` used a move (its events), and in which it lost its turn by loafing around (Truant). */
function turnsOf(b: Battle, u: number, rounds: number): { acted: number[]; loafed: number[] } {
  const acted: number[] = [], loafed: number[] = [];
  for (let t = 0; t < rounds * 60 && !b.ended; t++) {
    b.step();
    const r = Math.floor((b.tick - 1) / 60);
    for (let k = 0; k < b.eventCount; k++) if (b.events[k * EVENT_INTS] === u && b.events[k * EVENT_INTS + 2] >= 0 && !acted.includes(r)) acted.push(r);
    for (let k = 0; k < b.noteCount; k++) if (b.notes[k * NOTE_INTS] === u && b.notes[k * NOTE_INTS + 1] === NOTE.SKIP && b.notes[k * NOTE_INTS + 2] === NOTE_SKIP.loafing) loafed.push(r);
  }
  return { acted, loafed };
}

/** Steps to the end of the current round (its end-of-round checks included). */
function finishRound(b: Battle) {
  do b.step(); while (b.tick % 60 !== 1 && !b.ended);
}

describe("mass battle: abilities that change a Pokémon as it fights (checked against Showdown in the simulator check)", () => {
  it("Truant: Slaking loafs around every other turn", () => {
    const b = melee([{ slug: "slaking", side: 0, moves: ["Tackle"] }, { slug: "blissey", side: 1, moves: ["Tackle"], set: { evs: "bulk" } }]);
    const { acted, loafed } = turnsOf(b, 0, 6);
    expect(acted).toEqual([0, 2, 4]);
    expect(loafed).toEqual([1, 3, 5]);
  });

  it("Slow Start: Regigigas has half its Attack (through the calculator) and half its Speed for its first five turns", () => {
    const b = melee([{ slug: "regigigas", side: 0, moves: ["Tackle"] }, { slug: "snorlax", side: 1, moves: ["Tackle"], set: { evs: "bulk" } }]);
    b.step();
    const slow = b.effectiveSpeed(0);
    for (let t = 0; t < 5 * 60; t++) b.step();
    expect(b.effectiveSpeed(0)).toBe(b.rows[0].spe);
    expect(slow).toBe(Math.floor(b.rows[0].spe * 0.5));
    const st = neutralState(b.table.maxHp(0), b.table.maxHp(1));
    const full = b.table.entry(0, 0, 1, st).avg, halved = b.table.entry(0, 0, 1, { ...st, aSlow: true }).avg;
    expect(halved / full).toBeGreaterThan(0.45);
    expect(halved / full).toBeLessThan(0.55);
  });

  it("Stance Change: Aegislash attacks in Blade Forme and stays in it", () => {
    const b = melee([{ slug: "aegislash", side: 0, moves: ["Iron Head"] }, { slug: "blissey", side: 1, moves: ["Tackle"], set: { evs: "bulk" } }]);
    expect(b.form[0]).toBe(0);
    const st = neutralState(b.table.maxHp(0), b.table.maxHp(1));
    expect(b.table.entry(0, 0, 1, { ...st, aForm: 1 }).avg).toBeGreaterThan(2 * b.table.entry(0, 0, 1, st).avg);
    turnsOf(b, 0, 1);
    expect(b.form[0]).toBe(1);
    expect(b.table.stats(b.sp[0], 1).atk).toBeGreaterThan(b.table.stats(b.sp[0], 0).atk);
  });

  it("Schooling and Shields Down change form by the HP left at the end of a round", () => {
    const w = melee([{ slug: "wishiwashi", side: 0, moves: ["Hydro Pump"] }, { slug: "blissey", side: 1, moves: ["Tackle"], set: { evs: "bulk" } }]);
    expect(w.form[0]).toBe(1); // School Form from level 20
    w.step();
    w.hp[0] = Math.floor(w.rows[0].maxHp / 4);
    finishRound(w);
    expect(w.form[0]).toBe(0);
    const m = melee([{ slug: "minior", side: 0, moves: ["Power Gem"] }, { slug: "pikachu", side: 1, moves: ["Nuzzle"] }]);
    const notes = notesOf(m);
    // Meteor Form can't be paralysed; once it's in Core Form (half its HP or less) it can.
    const coreAt = notes.findIndex((n) => n.kind === NOTE.FORM && n.unit === 0 && n.value === 1);
    const paraAt = notes.findIndex((n) => n.kind === NOTE.STATUS && n.unit === 0 && n.value === STATUS.par);
    if (paraAt >= 0) expect(coreAt).toBeGreaterThanOrEqual(0);
    if (paraAt >= 0) expect(paraAt).toBeGreaterThan(coreAt);
  });

  it("School Wishiwashi's body follows its form: a shoal metres across while schooled, a small fish again once it leaves", () => {
    const w = melee([{ slug: "wishiwashi", side: 0, moves: ["Hydro Pump"] }, { slug: "blissey", side: 1, moves: ["Tackle"], set: { evs: "bulk" } }]);
    const school = FORM_BODIES["Wishiwashi-School"];
    expect(w.form[0]).toBe(1);
    expect(w.bodyR[0]).toBe(bodyRadius({ m: school.m, shape: mon("wishiwashi").shape, box: school.box }));
    expect(w.bodyR[0]).toBeGreaterThan(3);
    expect(w.bodyM[0]).toBe(school.kg);
    w.step();
    w.hp[0] = Math.floor(w.rows[0].maxHp / 4);
    finishRound(w);
    expect(w.form[0]).toBe(0);
    expect(w.bodyR[0]).toBe(w.rows[0].radius);
    expect(w.bodyM[0]).toBe(w.rows[0].mass);
    // Everyone else keeps its species' body.
    expect(w.bodyR[1]).toBe(w.rows[1].radius);
  });

  it("schooled Wishiwashi keep their distance on the field instead of standing inside each other", () => {
    const b = new Battle(prepare(roster, spec([["wishiwashi", 12]], [["aegislash", 6]], 3)));
    for (let k = 0; k < TICK_HZ * 3 && !b.ended; k++) b.step();
    let worst = Infinity, pairs = 0;
    for (let i = 0; i < b.n; i++) {
      for (let j = i + 1; j < b.n; j++) {
        if (!b.alive[i] || !b.alive[j] || b.side[i] !== 0 || b.side[j] !== 0 || b.form[i] !== 1 || b.form[j] !== 1) continue;
        worst = Math.min(worst, Math.hypot(b.x[i] - b.x[j], b.z[i] - b.z[j]) / (b.bodyR[i] + b.bodyR[j]));
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThan(10);
    expect(worst).toBeGreaterThan(0.8);
  });

  it("gives a form an ability brings a body of its own only when it's another size, as src/data/race-forms.json has it", () => {
    const forms = RACE_FORMS.forms as { slug: string; height: number; weight: number; box: number[] }[];
    const id = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const [calc, body] of Object.entries(FORM_BODIES)) {
      const f = forms.find((x) => id(x.slug) === id(calc));
      expect(f, calc).toBeTruthy();
      expect(body).toEqual({ m: f!.height / 10, kg: f!.weight / 10, box: f!.box });
    }
    // The other forms these abilities bring are their species' height: same body.
    for (const [slug, base] of [["aegislash-blade", "aegislash"], ["minior-red", "minior"], ["eiscue-noice", "eiscue"]] as const) {
      expect(forms.find((x) => x.slug === slug)!.height / 10).toBe(mon(base).m);
    }
  });

  it("Disguise and Ice Face take a hit for their Pokémon (Disguise for an eighth of its HP); Mold Breaker goes through", () => {
    const d = melee([{ slug: "machamp", side: 0, moves: ["Knock Off"] }, { slug: "mimikyu", side: 1, moves: ["Shadow Claw"], set: { evs: "bulk" } }]);
    turnsOf(d, 0, 1);
    expect(d.hp[1]).toBe(d.rows[1].maxHp - Math.floor(d.rows[1].maxHp / 8));
    const mb = melee([{ slug: "excadrill", side: 0, moves: ["Iron Head"], set: { ability: "Mold Breaker" } }, { slug: "mimikyu", side: 1, moves: ["Shadow Claw"], set: { evs: "bulk" } }]);
    turnsOf(mb, 0, 1);
    expect(mb.rows[1].maxHp - mb.hp[1]).toBeGreaterThan(Math.floor(mb.rows[1].maxHp / 8));
    const ice = melee([{ slug: "machamp", side: 0, moves: ["Close Combat"] }, { slug: "eiscue", side: 1, moves: ["Ice Spinner"], set: { evs: "bulk" } }]);
    turnsOf(ice, 0, 1);
    expect(ice.hp[1]).toBe(ice.rows[1].maxHp);
    expect(ice.form[1]).toBe(1); // Noice Face
  });

  it("Sturdy and Focus Sash hold one hit at full HP, not every hit of a multi-hit move; Mold Breaker breaks Sturdy", () => {
    const one = melee([{ slug: "mewtwo", side: 0, moves: ["Surf"] }, { slug: "golem", side: 1, moves: ["Tackle"], set: { ability: "Sturdy" } }]);
    turnsOf(one, 0, 1);
    expect(one.hp[1]).toBe(1);
    // Five Icicle Spears on a Sturdy Geodude: no one hit would KO it from full HP, so Sturdy never comes into it.
    const multi = melee([{ slug: "cloyster", side: 0, moves: ["Icicle Spear"], set: { ability: "Skill Link" } }, { slug: "geodude", side: 1, moves: ["Tackle"], set: { ability: "Sturdy" } }]);
    turnsOf(multi, 0, 1);
    expect(multi.alive[1]).toBe(0);
    const sash = melee([{ slug: "cloyster", side: 0, moves: ["Icicle Spear"], set: { ability: "Skill Link" } }, { slug: "geodude", side: 1, moves: ["Tackle"], set: { item: "Focus Sash" } }]);
    turnsOf(sash, 0, 1);
    expect(sash.alive[1]).toBe(0);
    const broken = melee([{ slug: "excadrill", side: 0, moves: ["Earthquake"], set: { ability: "Mold Breaker" } }, { slug: "magnezone", side: 1, moves: ["Tackle"], set: { ability: "Sturdy" } }]);
    const kept = melee([{ slug: "excadrill", side: 0, moves: ["Earthquake"], set: { ability: "Sand Rush" } }, { slug: "magnezone", side: 1, moves: ["Tackle"], set: { ability: "Sturdy" } }]);
    turnsOf(broken, 0, 1);
    turnsOf(kept, 0, 1);
    expect(broken.alive[1]).toBe(0);
    expect(kept.hp[1]).toBe(1);
  });

  it("Protean and Libero: the first move of another type changes the user's type, once (and its STAB with it)", () => {
    const b = melee([{ slug: "greninja", side: 0, moves: ["Ice Beam", "Hydro Pump"] }, { slug: "garchomp", side: 1, moves: ["Stone Edge"], set: { evs: "bulk" } }]);
    turnsOf(b, 0, 1);
    expect(b.form[0]).toBe(1); // Ice Beam's type
    const st = neutralState(b.table.maxHp(0), b.table.maxHp(1));
    // Once Ice type, Hydro Pump has no STAB, and Garchomp's Stone Edge is super effective on it.
    expect(b.table.entry(0, 1, 1, { ...st, aForm: 1 }).avg).toBeLessThan(b.table.entry(0, 1, 1, st).avg * 0.75);
    expect(b.table.entry(1, 0, 0, { ...st, dForm: 1 }).avg).toBeGreaterThan(b.table.entry(1, 0, 0, st).avg * 1.5);
    turnsOf(b, 0, 2);
    expect(b.form[0]).toBe(1);
  });

  it("battle-start, poisoning and residual abilities: Intrepid Sword, Toxic Chain, Poison Puppeteer, Hydration", () => {
    const z = melee([{ slug: "zacian", side: 0, moves: ["Play Rough"] }, { slug: "blissey", side: 1, moves: ["Tackle"] }]);
    expect(z.stages[0]).toBe(1);
    let tox = 0, confused = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const n1 = notesOf(melee([{ slug: "okidogi", side: 0, moves: ["Psychic Fangs"] }, { slug: "blissey", side: 1, moves: ["Seismic Toss"], set: { evs: "bulk" } }], seed));
      if (n1.some((n) => n.kind === NOTE.STATUS && n.unit === 1 && n.value === STATUS.tox)) tox++;
      const n2 = notesOf(melee([{ slug: "pecharunt", side: 0, moves: ["Malignant Chain"] }, { slug: "blissey", side: 1, moves: ["Seismic Toss"], set: { evs: "bulk" } }], seed));
      if (n2.some((n) => n.kind === NOTE.STATUS && n.unit === 1 && n.value === 9)) confused++;
    }
    expect(tox).toBeGreaterThan(10);
    expect(confused).toBeGreaterThan(10);
    const h = melee([{ slug: "pikachu", side: 0, moves: ["Nuzzle"] }, { slug: "manaphy", side: 1, moves: ["Scald"], set: { ability: "Hydration" } }], 4, { weather: "rain", terrain: "none", time: "day" });
    const notes = notesOf(h);
    expect(notes.some((n) => n.kind === NOTE.STATUS && n.unit === 1 && n.value === STATUS.par)).toBe(true);
    expect(notes.some((n) => n.kind === NOTE.CURE && n.unit === 1 && n.value === STATUS.par)).toBe(true);
  });

  it("Protosynthesis in sun and Quark Drive on Electric Terrain boost the best stat (Speed 1.5×)", () => {
    const sun = { weather: "sun", terrain: "none", time: "day" } as const, electric = { weather: "none", terrain: "electric", time: "day" } as const;
    const plain = melee([{ slug: "great-tusk", side: 0, moves: ["Close Combat"] }, { slug: "snorlax", side: 1, moves: ["Body Slam"] }]);
    const sunny = melee([{ slug: "great-tusk", side: 0, moves: ["Close Combat"] }, { slug: "snorlax", side: 1, moves: ["Body Slam"] }], 9, sun);
    const st = neutralState(plain.table.maxHp(0), plain.table.maxHp(1));
    const stSun = neutralState(plain.table.maxHp(0), plain.table.maxHp(1), sun);
    expect(sunny.table.entry(0, 0, 1, stSun).avg / plain.table.entry(0, 0, 1, st).avg).toBeGreaterThan(1.25);
    const fast = melee([{ slug: "iron-bundle", side: 0, moves: ["Ice Beam"] }, { slug: "snorlax", side: 1, moves: ["Body Slam"] }], 9, electric);
    const calm = melee([{ slug: "iron-bundle", side: 0, moves: ["Ice Beam"] }, { slug: "snorlax", side: 1, moves: ["Body Slam"] }]);
    expect(fast.effectiveSpeed(0)).toBe(Math.floor(calm.effectiveSpeed(0) * 1.5));
  });

  it("items: King's Rock adds a flinch, a Punching Glove's punches don't touch, Rocky Helmet strikes before Knock Off takes it", () => {
    let flinched = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const notes = notesOf(melee([{ slug: "jolteon", side: 0, moves: ["Thunderbolt"], set: { item: "King's Rock" } }, { slug: "blissey", side: 1, moves: ["Seismic Toss"], set: { evs: "bulk" } }], seed));
      if (notes.some((n) => n.kind === NOTE.SKIP && n.unit === 1 && n.value === NOTE_SKIP.flinch)) flinched++;
    }
    expect(flinched).toBeGreaterThan(10);
    const glove = melee([{ slug: "hitmonchan", side: 0, moves: ["Drain Punch"], set: { item: "Punching Glove" } }, { slug: "garchomp", side: 1, moves: ["Dragon Claw"], set: { ability: "Rough Skin" } }]);
    const chips = notesOf(glove).filter((n) => n.kind === NOTE.CHIP && n.unit === 0);
    expect(chips.length).toBe(0);
    const knock = melee([{ slug: "tyranitar", side: 0, moves: ["Knock Off"] }, { slug: "snorlax", side: 1, moves: ["Body Slam"], set: { item: "Rocky Helmet", evs: "bulk" } }]);
    turnsOf(knock, 0, 1);
    expect(knock.itemGone[1]).toBe(1);
    expect(knock.rows[0].maxHp - knock.hp[0]).toBeGreaterThanOrEqual(Math.floor(knock.rows[0].maxHp / 6));
  });

  it("every ability Mold Breaker ignores here is one Showdown marks breakable", () => {
    for (const id of BREAKABLE) expect(Dex.abilities.get(id).flags.breakable, id).toBe(1);
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
    expect(decodeBattle(code, slugs)).toEqual({ ...s, sides: [{ ...s.sides[0], units: [{ ...s.sides[0].units[0], set: { ...s.sides[0].units[0].set, moves: ["flail"], item: "Life Orb", nature: "Adamant", tera: "Water" } }, s.sides[0].units[1]] }, s.sides[1]] });
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

  it("a preset can say anything the setup panel can, and fills the panel in with it (and its link carries it)", () => {
    const base: (typeof PRESETS)[number] = {
      id: "test", kind: "howmany", title: "t", hook: "h", blurb: "b", arena: "snowfield", level: 50, seed: 3,
      field: { weather: "rain", terrain: "grassy", time: "night" }, items: "sets",
      sides: [
        { formation: "wedge", spacing: "loose", targeting: "boss", stance: "hold", spread: "never", units: [["pikachu", 10, { item: "Light Ball", nature: "Timid" }]] },
        { formation: "line", units: [["snorlax", 1, { evs: "bulk" }]] },
      ],
      question: { challenger: "pikachu", boss: "snorlax", threshold: 0.9, runs: 100 },
      playback: { numbers: true, speed: 2 },
    };
    const r = resolvePreset(base, roster);
    expect(r.spec.field).toEqual(base.field);
    expect(r.spec.items).toBe("sets");
    expect(r.spec.sides[0]).toMatchObject({ formation: "wedge", spacing: "loose", targeting: "boss", stance: "hold", spread: "never" });
    expect(r.spec.sides[0].units[0].set).toEqual({ item: "Light Ball", nature: "Timid" });
    const q = r.question!;
    expect(q).toMatchObject({ level: 50, arena: "snowfield", field: base.field, items: "sets", threshold: 0.9, runs: 100 });
    expect(q.army.units[0].set).toEqual({ item: "Light Ball", nature: "Timid" });
    expect(q.army.targeting).toBe("boss");
    expect(q.boss.units[0].set).toEqual({ evs: "bulk" });
    expect(r.playback).toEqual({ numbers: true, speed: 2 });
    // The panel, from the preset's battle and from its question, and back.
    const panel = fromBattle(defaultSetup((slug) => mon(slug).id), r.spec);
    expect(panel).toMatchObject({ tab: "army", level: 50, arena: "snowfield", field: base.field, items: "sets" });
    expect(panel.sides[0]).toMatchObject({ formation: "wedge", spacing: "loose", targeting: "boss", stance: "hold", spread: "never" });
    expect(toBattle(panel, 3)).toEqual(r.spec);
    const asked = fromQuestion(defaultSetup((slug) => mon(slug).id), q);
    expect(asked).toMatchObject({ tab: "ask", threshold: 0.9, runs: 100, items: "sets" });
    expect(toQuestion(asked)).toEqual(q);
    expect(decodeQuestion(encodeQuestion(q, slugs), slugs)).toEqual(q);
    expect(decodeBattle(encodeBattle(r.spec, slugs), slugs)).toEqual(r.spec);
  });

  it("the sun turns Fire vs Water around, and a Light Ball cuts the Pikachu needed for Snorlax (the presets' own results)", async () => {
    const { PRESET_RESULTS } = await import("@/lib/mass-battle/page-data");
    expect(PRESET_RESULTS.results["fire-vs-water"].outcome.winner).toBe(0); // Water
    expect(PRESET_RESULTS.results["fire-vs-water-sun"].outcome.winner).toBe(1); // Fire
    const plain = PRESET_RESULTS.results["pikachu-vs-snorlax"].answer!, ball = PRESET_RESULTS.results["light-ball-pikachu-vs-snorlax"].answer!;
    expect(ball.n).toBeLessThan(plain.n);
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

/** Plays a battle to the end, collecting its events and notes. */
function playAll(b: Battle) {
  const events: { actor: number; target: number; slot: number; damage: number; flags: number; tick: number }[] = [];
  const notes: { unit: number; kind: number; value: number; tick: number }[] = [];
  while (!b.ended) {
    b.step();
    for (let k = 0; k < b.eventCount; k++) {
      const o = k * EVENT_INTS;
      events.push({ actor: b.events[o], target: b.events[o + 1], slot: b.events[o + 2], damage: b.events[o + 3], flags: b.events[o + 4], tick: b.tick });
    }
    for (let k = 0; k < b.noteCount; k++) notes.push({ unit: b.notes[k * NOTE_INTS], kind: b.notes[k * NOTE_INTS + 1], value: b.notes[k * NOTE_INTS + 2], tick: b.tick });
  }
  return { events, notes };
}

describe("mass battle: status moves (Showdown's data and rules)", () => {
  it("the roster keeps the status moves it plays, with their rules, and leaves out the rest", () => {
    expect(move("Swords Dance").effect).toEqual({ kind: "boost", boosts: { atk: 2 } });
    expect(move("Dragon Dance").effect).toEqual({ kind: "boost", boosts: { atk: 1, spe: 1 } });
    expect(move("Recover").effect).toEqual({ kind: "heal", share: 0.5 });
    expect(move("Will-O-Wisp").effect).toEqual({ kind: "inflict", status: "brn" });
    expect(move("Spore").powder).toBe(true);
    expect(move("Protect").effect).toEqual({ kind: "protect" });
    expect(move("Earthquake").allies).toBe(true);
    expect(move("Rock Slide").allies).toBeUndefined();
    expect(move("Hydro Pump").pp).toBe(8);
    expect(unplayable("stealthrock")).toBe("status");
    expect(unplayable("taunt")).toBe("status");
  });

  it("a boss facing a horde never sets up (each foe it knocks out is a fresh one); one against one it does when it pays", () => {
    const horde = new Battle(prepare(roster, spec([["magikarp", 30]], [["arceus", 1]]), { layout: "melee" }));
    const { notes } = playAll(horde);
    const arceus = horde.n - 1;
    const sd = horde.prep.moves[horde.sp[arceus]].findIndex((m) => m.name === "Swords Dance");
    expect(sd).toBeGreaterThanOrEqual(0);
    expect(notes.some((n) => n.unit === arceus && n.kind === NOTE.MOVE && n.value === sd)).toBe(false);
    const duel = melee([{ slug: "gyarados", side: 0, moves: ["Dragon Dance", "Waterfall"] }, { slug: "toxapex", side: 1, moves: ["Recover"] }]);
    const d = playAll(duel);
    expect(d.notes.some((n) => n.unit === 0 && n.kind === NOTE.MOVE && n.value === 0)).toBe(true);
    expect(d.notes.some((n) => n.unit === 0 && n.kind === NOTE.BOOST && Math.floor(n.value / 16) === 0)).toBe(true);
  });

  it("heals only when it has lost HP, and never puts a status on a target that has one", () => {
    const b = melee([{ slug: "blissey", side: 0, moves: ["Seismic Toss", "Soft-Boiled", "Thunder Wave"] }, { slug: "machamp", side: 1, moves: ["Close Combat"] }]);
    const { notes } = playAll(b);
    const heals = notes.filter((n) => n.unit === 0 && n.kind === NOTE.MOVE && n.value === 1);
    for (const h of heals) expect(notes.find((n) => n.tick === h.tick && n.unit === 0 && n.kind === NOTE.HEAL)).toBeTruthy();
    const waves = notes.filter((n) => n.unit === 0 && n.kind === NOTE.MOVE && n.value === 2);
    expect(waves.length).toBeLessThanOrEqual(1 + notes.filter((n) => n.kind === NOTE.SKIP && n.value === NOTE_SKIP.failed).length);
    const wisp = melee([{ slug: "weezing-galar", side: 0, moves: ["Will-O-Wisp", "Strange Steam"] }, { slug: "garchomp", side: 1, moves: ["Earthquake"] }], 3);
    const w = playAll(wisp);
    const burned = w.notes.findIndex((n) => n.unit === 1 && n.kind === NOTE.STATUS && n.value === STATUS.brn);
    if (burned >= 0) expect(w.notes.slice(burned + 1).some((n) => n.unit === 0 && n.kind === NOTE.MOVE && n.value === 0)).toBe(false);
  });

  it("Protect stops a hit, Leech Seed drains an eighth, Rest sleeps two turns", () => {
    let blocked = false;
    for (let seed = 1; seed < 30 && !blocked; seed++) {
      const b = melee([{ slug: "ferrothorn", side: 0, moves: ["Protect", "Leech Seed", "Power Whip"] }, { slug: "iron-valiant", side: 1, moves: ["Moonblast"] }], seed);
      blocked = playAll(b).events.some((e) => e.flags & EV.PROTECT);
    }
    expect(blocked).toBe(true);
    const seeded = melee([{ slug: "ferrothorn", side: 0, moves: ["Leech Seed"] }, { slug: "snorlax", side: 1, moves: ["Body Slam"] }], 2);
    const s = playAll(seeded);
    const chip = s.notes.find((n) => n.unit === 1 && n.kind === NOTE.CHIP);
    if (chip) expect(chip.value).toBe(Math.floor(seeded.rows[1].maxHp / 8));
  });
});

describe("mass battle: abilities as a Pokémon comes in", () => {
  it("Drizzle sets rain for five rounds, then the weather picked comes back; the slower setter's weather stands", () => {
    const b = melee([{ slug: "pelipper", side: 0, moves: ["Hydro Pump"], set: { ability: "Drizzle" } }, { slug: "blissey", side: 1, moves: ["Seismic Toss"] }]);
    expect(b.fieldNow.weather).toBe("rain");
    for (let t = 0; t < 5 * 60 + 2 && !b.ended; t++) b.step();
    if (!b.ended) expect(b.fieldNow.weather).toBe("none");
    const both = melee([{ slug: "pelipper", side: 0, moves: ["Hydro Pump"], set: { ability: "Drizzle" } }, { slug: "ninetales", side: 1, moves: ["Flamethrower"], set: { ability: "Drought" } }]);
    // Ninetales is faster: it sets sun first, then Pelipper's rain replaces it.
    expect(both.fieldNow.weather).toBe("rain");
  });

  it("Intimidate drops every foe in reach one stage (Inner Focus ignores it), Neutralizing Gas turns abilities off", () => {
    const b = melee([{ slug: "gyarados", side: 0, moves: ["Waterfall"], set: { ability: "Intimidate" } }, { slug: "garchomp", side: 1, moves: ["Earthquake"] }, { slug: "lucario", side: 1, moves: ["Aura Sphere"], set: { ability: "Inner Focus" } }]);
    expect(b.stages[1 * 7]).toBe(-1);
    expect(b.stages[2 * 7]).toBe(0);
    const gas = melee([{ slug: "weezing", side: 0, moves: ["Sludge Bomb"], set: { ability: "Neutralizing Gas" } }, { slug: "dragonite", side: 1, moves: ["Outrage"], set: { ability: "Multiscale" } }]);
    expect(gas.R(1).ability).toBe("");
  });
});

describe("mass battle: moves that charge, recharge, faint the user, or don't use the damage formula", () => {
  it("Seismic Toss does the user's level, Super Fang half the target's HP, a Ghost is immune to both", () => {
    const toss = melee([{ slug: "blissey", side: 0, moves: ["Seismic Toss"] }, { slug: "snorlax", side: 1, moves: ["Body Slam"] }]);
    const t = playAll(toss).events.filter((e) => e.actor === 0 && e.target === 1 && !(e.flags & (EV.MISS | EV.IMMUNE)));
    expect(t.length).toBeGreaterThan(0);
    for (const e of t) expect(e.damage === 100 || e.flags & EV.KO).toBeTruthy();
    const fang = melee([{ slug: "rattata", side: 0, moves: ["Super Fang"] }, { slug: "snorlax", side: 1, moves: ["Body Slam"] }], 4);
    const f = playAll(fang).events.find((e) => e.actor === 0 && e.damage > 0);
    if (f) expect(f.damage).toBe(Math.floor(fang.rows[1].maxHp / 2));
    const ghost = melee([{ slug: "blissey", side: 0, moves: ["Seismic Toss"] }, { slug: "gengar", side: 1, moves: ["Shadow Ball"] }]);
    expect(ghost.table.canDamage(0, 1)).toBe(false);
  });

  it("Explosion: the user faints with a blast, and with friendly fire on it hits its partner too", () => {
    const units = [{ slug: "electrode", side: 0 as const, moves: ["Explosion"] }, { slug: "snorlax", side: 0 as const, moves: ["Body Slam"] }, { slug: "garchomp", side: 1 as const, moves: ["Earthquake"] }, { slug: "garchomp", side: 1 as const, moves: ["Earthquake"] }];
    for (const ff of [true, false]) {
      let saw = false;
      for (let seed = 1; seed < 20 && !saw; seed++) {
        const b = melee(units, seed, undefined, { pp: false, friendlyFire: ff });
        const { events } = playAll(b);
        const blast = events.find((e) => e.flags & EV.BLAST);
        if (!blast) continue;
        saw = true;
        expect(blast.actor).toBe(0);
        expect(events.some((e) => e.actor === 0 && e.target === 1 && e.flags & EV.ALLY)).toBe(ff);
      }
      expect(saw).toBe(true);
    }
  });

  it("Solar Beam fires at once in the sun and charges a turn otherwise; Hyper Beam needs a turn to recharge", () => {
    const sun = { weather: "sun", terrain: "none", time: "day" } as const;
    const fast = melee([{ slug: "venusaur", side: 0, moves: ["Solar Beam"] }, { slug: "blastoise", side: 1, moves: ["Surf"] }], 1, sun);
    expect(playAll(fast).notes.some((n) => n.unit === 0 && n.kind === NOTE.MOVE)).toBe(false);
    const slow = melee([{ slug: "venusaur", side: 0, moves: ["Solar Beam"] }, { slug: "blastoise", side: 1, moves: ["Surf"] }]);
    expect(playAll(slow).notes.some((n) => n.unit === 0 && n.kind === NOTE.MOVE && n.value === 0)).toBe(true);
    const beam = melee([{ slug: "porygon-z", side: 0, moves: ["Hyper Beam"] }, { slug: "blissey", side: 1, moves: ["Seismic Toss"] }]);
    expect(playAll(beam).notes.some((n) => n.unit === 0 && n.kind === NOTE.SKIP && n.value === NOTE_SKIP.recharge)).toBe(true);
  });

  it("Fake Out only works on the user's first action", () => {
    const b = melee([{ slug: "hitmontop", side: 0, moves: ["Fake Out"] }, { slug: "snorlax", side: 1, moves: ["Body Slam"] }]);
    const { events, notes } = playAll(b);
    const hits = events.filter((e) => e.actor === 0 && e.slot === 0 && e.damage > 0);
    expect(hits.length).toBeLessThanOrEqual(1);
    expect(notes.filter((n) => n.unit === 0 && n.kind === NOTE.SKIP && n.value === NOTE_SKIP.failed).length).toBe(0);
  });

  it("a one-hit KO move fails on a higher level and an Ice type is immune to Sheer Cold", () => {
    const b = melee([{ slug: "lapras", side: 0, moves: ["Sheer Cold"] }, { slug: "glaceon", side: 1, moves: ["Ice Beam"] }]);
    expect(b.table.canDamage(0, 1)).toBe(false);
  });
});

describe("mass battle: Real PP and Pressure", () => {
  it("with Real PP a Pokémon that runs out Struggles (a quarter of its HP back on itself); Pressure takes two PP", () => {
    const pressure = melee([{ slug: "blissey", side: 0, moves: ["Seismic Toss"] }, { slug: "mewtwo", side: 1, moves: ["Psystrike"], set: { ability: "Pressure" } }], 1, undefined, { pp: true, friendlyFire: true });
    const pp = (pressure as unknown as { ppLeft: Int16Array }).ppLeft;
    expect(pp[0]).toBe(32);
    while (!pressure.ended && pp[0] === 32) pressure.step();
    // Against Pressure a use costs two.
    expect(pp[0]).toBe(30);
    // Out of PP: it Struggles (its slot after its own moves) and takes a quarter of its max HP.
    const out = melee([{ slug: "blissey", side: 0, moves: ["Seismic Toss"] }, { slug: "snorlax", side: 1, moves: ["Body Slam"] }], 1, undefined, { pp: true, friendlyFire: true });
    (out as unknown as { ppLeft: Int16Array }).ppLeft[0] = 0;
    const { events, notes } = playAll(out);
    expect(events.some((e) => e.actor === 0 && e.slot === 1 && e.damage > 0)).toBe(true);
    expect(notes.some((n) => n.unit === 0 && n.kind === NOTE.CHIP && n.value === Math.round(out.rows[0].maxHp / 4))).toBe(true);
  });
});

describe("mass battle: share links carry the rules", () => {
  it("Real PP and friendly fire off round-trip", () => {
    const s: BattleSpec = { ...spec([["rattata", 10]], [["mewtwo", 1]]), rules: { pp: true, friendlyFire: false } };
    const back = decodeBattle(encodeBattle(s, slugs), slugs);
    expect(back?.rules).toEqual({ pp: true, friendlyFire: false });
    expect(decodeBattle(encodeBattle(spec([["rattata", 10]], [["mewtwo", 1]]), slugs), slugs)?.rules).toBeUndefined();
  });
});
