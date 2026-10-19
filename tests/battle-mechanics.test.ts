import { describe, expect, it } from "vitest";
import { Battle, Dex as ShowdownDex, TeamValidator, Teams } from "pokemon-showdown";
import { Dex } from "@pkmn/dex";
import { Generations } from "@pkmn/data";
import * as SmogonCalc from "@smogon/calc";
import * as AdaptableCalc from "@smogon/calc/dist/adaptable";
import { effectiveness, moveInfo, type MoveInfo } from "@/components/battle/play/moves";
import type { MonSnap } from "@/components/battle/play/model";
import { BATTLE_FORMATS, BATTLE_FORMAT_IDS } from "@/lib/battle/formats";
import { PLAY_FORMAT_INFO, PLAY_FORMATS } from "@/lib/battle/play";
import { calcMoves, emptyField, sideFromSet, type CalcSide } from "@/lib/battle/calc";
import { loadCalcGenerations } from "@/lib/battle/dex";
import { completeSet, fitSetToGen, fitStatsToGen, fromDV, newSet, packTeam, STATS, type TeamSet } from "@/lib/battle/sets";
import { field } from "@/lib/battle/cpu-policy";
import { labFormatId } from "@/lib/battle/lab/types";

/**
 * What the Battle pages state or work out themselves, against Pokémon
 * Showdown (the official simulator and its data) and @smogon/calc: format
 * names, move data and type effectiveness in each generation, stats under
 * each generation's rules, damage and the computer's view of the field.
 */

const gens = new Generations(Dex);

describe("formats", () => {
  it("every format offered is a real Showdown format, under its real name", () => {
    for (const id of BATTLE_FORMAT_IDS) {
      const format = ShowdownDex.formats.get(id);
      expect(format.exists, id).toBe(true);
      expect(BATTLE_FORMATS[id].name).toBe(format.name);
      expect(`gen${BATTLE_FORMATS[id].gen}`).toBe(format.mod);
      expect(BATTLE_FORMATS[id].gameType).toBe(format.gameType);
    }
    for (const id of PLAY_FORMATS) {
      const format = ShowdownDex.formats.get(id);
      expect(format.exists, id).toBe(true);
      expect(PLAY_FORMAT_INFO[id].name).toBe(format.name);
      expect(PLAY_FORMAT_INFO[id].gameType).toBe(format.gameType);
    }
    for (let gen = 1; gen <= 9; gen++) {
      for (const doubles of gen >= 3 ? [false, true] : [false]) expect(ShowdownDex.formats.get(labFormatId(gen as never, doubles)).exists).toBe(true);
    }
  });

  it("each team-builder format's level is the one its rules set", () => {
    for (const id of BATTLE_FORMAT_IDS) {
      const table = ShowdownDex.formats.getRuleTable(ShowdownDex.formats.get(id));
      expect(BATTLE_FORMATS[id].level, id).toBe(table.adjustLevel ?? table.defaultLevel ?? 100);
    }
  });
});

describe("the move menu", () => {
  it("shows each generation's own move data", () => {
    for (let gen = 1; gen <= 9; gen++) {
      const dex = ShowdownDex.forGen(gen);
      for (const move of dex.moves.all()) {
        if (move.isNonstandard && move.isNonstandard !== "Past") continue;
        if (move.gen > gen) continue;
        const info = moveInfo(move.name, gen);
        const actual = [info.type, info.category, info.power, info.accuracy, info.priority];
        expect(actual, `gen ${gen} ${move.name}`).toEqual([move.type, move.category, move.basePower, move.accuracy, move.priority]);
      }
    }
  });

  it("reads Showdown's request names: typed Hidden Power and the power it adds", () => {
    const battle = new Battle({ formatid: "gen4customgame", seed: "1,2,3,4" });
    const team = Teams.pack(Teams.import("Pikachu\nIVs: 30 Atk / 30 SpA / 30 Spe\n- Hidden Power Fire\n- Return\n- Frustration\n- Bite")!);
    battle.setPlayer("p1", { name: "a", team });
    battle.setPlayer("p2", { name: "b", team });
    const moves = (battle.p1.activeRequest as unknown as { active: { moves: { move: string }[] }[] }).active[0].moves;
    const shown = moves.map((m) => moveInfo(m.move, 4));
    expect(shown.map((m) => [m.name, m.type, m.category])).toEqual([
      ["Hidden Power Fire", "Fire", "Special"],
      ["Return", "Normal", "Physical"],
      ["Frustration", "Normal", "Physical"],
      ["Bite", "Dark", "Physical"],
    ]);
    const pikachu = battle.p1.pokemon[0];
    expect(shown[0].power).toBe(pikachu.hpPower);
    expect(shown[1].power).toBe(Math.floor((pikachu.happiness * 10) / 25) || 1);
  });

  const mon = (types: string[]): MonSnap => ({ types, fainted: false }) as MonSnap;
  const verdict = (gen: number, type: string, defender: string[]): string => {
    const dex = ShowdownDex.forGen(gen);
    if (!dex.getImmunity(type, defender)) return "immune";
    const mod = dex.getEffectiveness(type, defender);
    return mod > 0 ? "super" : mod < 0 ? "resisted" : "neutral";
  };

  it("labels type effectiveness on each generation's type chart", () => {
    for (let gen = 1; gen <= 9; gen++) {
      const types = [...gens.get(gen).types].map((t) => t.name as string).filter((t) => t !== "???" && t !== "Stellar");
      for (const type of types) {
        const move: MoveInfo = { ...moveInfo("Tackle", gen), id: "x", type, category: "Physical" };
        for (const a of types) {
          for (const b of types) {
            const defender = a === b ? [a] : [a, b];
            expect(effectiveness(move, mon(defender), undefined, gen), `gen ${gen} ${type} vs ${defender}`).toBe(verdict(gen, type, defender));
          }
        }
      }
    }
  });

  it("knows the moves that bend the type chart, as the simulator plays them", () => {
    const cases: [string, string, string[]][] = [
      ["Freeze-Dry", "Gyarados", ["Water", "Flying"]],
      ["Freeze-Dry", "Swampert", ["Water", "Ground"]],
      ["Flying Press", "Venusaur", ["Grass", "Poison"]],
      ["Flying Press", "Gengar", ["Ghost", "Poison"]],
      ["Thousand Arrows", "Zapdos", ["Electric", "Flying"]],
      ["Thousand Arrows", "Corviknight", ["Flying", "Steel"]],
    ];
    for (const [moveName, target, types] of cases) {
      // Gen 7 has all three moves.
      const battle = new Battle({ formatid: "gen7customgame", seed: "1,2,3,4" });
      battle.setPlayer("p1", { name: "a", team: Teams.pack(Teams.import(`Mew\n- ${moveName}`)!) });
      battle.setPlayer("p2", { name: "b", team: Teams.pack(Teams.import(`${target}\n- Splash`)!) });
      const move = battle.dex.getActiveMove(moveName);
      const foe = battle.p2.pokemon[0];
      const immune = !foe.runImmunity(move) && !(move.ignoreImmunity && (move.ignoreImmunity === true || move.ignoreImmunity[move.type]));
      const mod = immune ? null : foe.runEffectiveness(move);
      const expected = mod === null ? "immune" : mod > 0 ? "super" : mod < 0 ? "resisted" : "neutral";
      expect(effectiveness(moveInfo(moveName, 7), mon(types), undefined, 7), `${moveName} vs ${target}`).toBe(expected);
    }
  });
});

describe("stats under each generation's rules", () => {
  const species = ["Mewtwo", "Snorlax", "Gengar", "Tauros", "Blissey", "Shedinja"];

  it("the stat editor's numbers are the simulator's, Gen 1-2 DVs and stat experience included", () => {
    for (let gen = 1; gen <= 9; gen++) {
      const data = gens.get(gen);
      for (const [i, name] of species.entries()) {
        const specie = data.species.get(name);
        if (!specie) continue;
        // Odd DVs and uneven EVs, made legal for the generation the way the editor does.
        const raw = newSet(name, { level: 50 + i * 9, gen });
        const stats = fitStatsToGen(
          { evs: { hp: 252, atk: 4, def: 128, spa: 200, spd: 60, spe: 36 }, ivs: { hp: 31, atk: fromDV(13), def: fromDV(6), spa: 31, spd: 20, spe: fromDV(9) } },
          gen
        );
        const set: TeamSet = { ...raw, ...stats, nature: gen >= 3 ? "Adamant" : "" };
        const battle = new Battle({ formatid: `gen${gen}customgame`, seed: "1,2,3,4" });
        battle.setPlayer("p1", { name: "a", team: packTeam([set]) });
        battle.setPlayer("p2", { name: "b", team: packTeam([set]) });
        const p = battle.p1.pokemon[0];
        const nature = data.natures.get(set.nature);
        const shown = Object.fromEntries(STATS.map((s) => [s, data.stats.calc(s, specie.baseStats[s], set.ivs[s], set.evs[s], set.level, nature)]));
        expect({ hp: shown.hp }, `gen ${gen} ${name} HP`).toEqual({ hp: p.maxhp });
        for (const s of STATS.slice(1)) expect(shown[s], `gen ${gen} ${name} ${s}`).toBe(p.storedStats[s as "atk"]);
      }
    }
  });

  it("Gen 1-2 sets pass Showdown's DV rules (one Special DV, HP DV from the others)", () => {
    for (const gen of [1, 2]) {
      const set = completeSet({ species: "Snorlax", moves: ["Body Slam"], level: 100 });
      const fitted = { ...set, ...fitStatsToGen({ evs: set.evs, ivs: { hp: 31, atk: fromDV(14), def: fromDV(11), spa: fromDV(12), spd: 31, spe: fromDV(15) } }, gen) };
      const problems = new TeamValidator(`gen${gen}ou`).validateSet(structuredClone(fitted) as never, {}) ?? [];
      expect(problems.filter((p) => /DV/.test(p)), `gen ${gen}`).toEqual([]);
    }
  });

  it("a Gen 1-2 set drops what those games don't have (a Custom Game would still apply it)", () => {
    const set = completeSet({ species: "Gengar", ability: "Levitate", nature: "Timid", item: "Leftovers", moves: ["Lick"] });
    expect(fitSetToGen(set, 2)).toMatchObject({ ability: "", nature: "", item: "Leftovers" });
    expect(fitSetToGen(set, 1)).toMatchObject({ ability: "", nature: "", item: "" });
    expect(fitSetToGen(set, 3)).toMatchObject({ ability: "Levitate", nature: "Timid", item: "Leftovers" });
  });

  it("new sets get Showdown's defaults: maxed stat experience in Gen 1-2 only", () => {
    expect(newSet("Snorlax", { level: 100, gen: 2 }).evs.hp).toBe(252);
    expect(newSet("Snorlax", { level: 100, gen: 3 }).evs.hp).toBe(0);
    expect(newSet("Snorlax", { level: 100, gen: 9 }).ivs.spe).toBe(31);
  });
});

describe("the damage calculator", () => {
  const sets: [number, CalcSide, CalcSide][] = [
    [
      9,
      { ...sideFromSet(completeSet({ species: "Garchomp", ability: "Rough Skin", item: "Life Orb", nature: "Jolly", evs: { atk: 252, spe: 252 }, moves: ["Earthquake", "Dragon Claw", "Stone Edge", "Fire Fang"] })), teraType: "Ground", terastallized: true },
      sideFromSet(completeSet({ species: "Heatran", ability: "Flash Fire", item: "Leftovers", nature: "Calm", evs: { hp: 252, spd: 252 }, moves: [] })),
    ],
    [
      4,
      sideFromSet(completeSet({ species: "Tyranitar", ability: "Sand Stream", item: "Choice Band", nature: "Adamant", evs: { atk: 252, hp: 252 }, moves: ["Crunch", "Stone Edge", "Pursuit", "Earthquake"] })),
      sideFromSet(completeSet({ species: "Starmie", ability: "Natural Cure", item: "Leftovers", nature: "Timid", evs: { spa: 252, spe: 252 }, moves: [] })),
    ],
    [
      3,
      sideFromSet(completeSet({ species: "Metagross", ability: "Clear Body", item: "Choice Band", nature: "Adamant", evs: { atk: 252, hp: 252 }, moves: ["Meteor Mash", "Earthquake", "Explosion", "Shadow Ball"] })),
      sideFromSet(completeSet({ species: "Skarmory", ability: "Keen Eye", item: "Leftovers", nature: "Impish", evs: { hp: 252, def: 252 }, moves: [] })),
    ],
  ];

  it("matches @smogon/calc on its own data, generation by generation", async () => {
    const calcGens = await loadCalcGenerations();
    for (const [gen, attacker, defender] of sets) {
      const field = { ...emptyField(), weather: gen === 4 ? "Sand" : "" };
      const lines = calcMoves({ gen: calcGens.get(gen), lib: AdaptableCalc }, attacker, defender, field);
      const reference = SmogonCalc.Generations.get(gen as SmogonCalc.GenerationNum);
      for (const line of lines) {
        const mk = (s: CalcSide) =>
          new SmogonCalc.Pokemon(reference, s.species, {
            level: s.level,
            ability: s.ability as never,
            item: s.item as never,
            nature: s.nature as never,
            evs: s.evs,
            ivs: s.ivs,
            teraType: (s.terastallized ? s.teraType : undefined) as never,
          });
        const result = SmogonCalc.calculate(reference, mk(attacker), mk(defender), new SmogonCalc.Move(reference, line.move), new SmogonCalc.Field({ weather: field.weather ? (field.weather as never) : undefined }));
        expect(line.damage, `gen ${gen} ${line.move}`).toEqual(result.range());
      }
    }
  });
});

describe("the computer's view of the field", () => {
  it("passes weather, screens, hazards and Gravity to the calculator, for each direction", () => {
    const battle = new Battle({ formatid: "gen9customgame", seed: "1,2,3,4" });
    const team = Teams.pack(Teams.import("Chien-Pao\nAbility: Sword of Ruin\n- Icicle Crash")!);
    battle.setPlayer("p1", { name: "a", team });
    battle.setPlayer("p2", { name: "b", team: Teams.pack(Teams.import("Snorlax\n- Body Slam")!) });
    if (battle.p1.activeRequest?.teamPreview) battle.makeChoices("team 1", "team 1");
    const source = battle.p1.pokemon[0];
    battle.field.setWeather("snowscape", source);
    battle.field.addPseudoWeather("gravity", source);
    battle.p1.addSideCondition("reflect", source);
    battle.p2.addSideCondition("stealthrock", source);
    battle.p2.addSideCondition("spikes", source);
    battle.p2.addSideCondition("spikes", source);
    const f = field(battle as never, false, battle.p1 as never);
    expect(f.weather).toBe("Snow");
    expect(f.isGravity).toBe(true);
    expect(f.isSwordOfRuin).toBe(true);
    expect(f.attackerSide.isReflect).toBe(true);
    expect(f.defenderSide.isReflect).toBe(false);
    expect(f.defenderSide.isSR).toBe(true);
    expect(f.defenderSide.spikes).toBe(2);
    const back = field(battle as never, false, battle.p2 as never);
    expect(back.defenderSide.isReflect).toBe(true);
  });
});
