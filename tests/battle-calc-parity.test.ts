import { beforeAll, describe, expect, it } from "vitest";
import type { Generations } from "@pkmn/data";
import * as adaptable from "@smogon/calc/dist/adaptable";
import * as smogon from "@smogon/calc";
import { calcMoves, emptyField, emptySide, type CalcField, type CalcSide } from "@/lib/battle/calc";
import { loadCalcGenerations } from "@/lib/battle/dex";

/**
 * Our calculator page and battle tooltips run @smogon/calc's adaptable build
 * on @pkmn/data. Every case here is checked against @smogon/calc's own build
 * with its own bundled data, so a data or glue mismatch shows up here.
 */

let gens: Generations;
beforeAll(async () => {
  gens = await loadCalcGenerations();
});

type SideIn = Partial<CalcSide> & { species: string };
type Case = { name: string; gen: number; a: SideIn; d: SideIn; move: string; field?: Partial<CalcField> };

const side = (s: SideIn): CalcSide => ({ ...emptySide(s.species, s.level ?? 100), ...s });

function theirs(c: Case) {
  const a = side(c.a);
  const d = side(c.d);
  const f = { ...emptyField(), ...c.field };
  const gen = c.gen as smogon.GenerationNum;
  const mk = (s: CalcSide) => {
    const p = new smogon.Pokemon(gen, s.species, {
      level: s.level,
      ability: s.ability || undefined,
      abilityOn: s.abilityOn,
      item: s.item || undefined,
      nature: s.nature,
      evs: s.evs,
      ivs: s.ivs,
      boosts: s.boosts,
      status: s.status,
      teraType: s.terastallized && s.teraType ? (s.teraType as never) : undefined,
      isDynamaxed: s.dynamaxed || undefined,
    });
    const max = p.maxHP();
    p.originalCurHP = Math.max(1, Math.min(max, Math.round((max * s.hpPercent) / 100)));
    return p;
  };
  const field = new smogon.Field({
    gameType: f.gameType,
    weather: (f.weather || undefined) as never,
    terrain: (f.terrain || undefined) as never,
    ...f.flags,
    attackerSide: { ...a.flags, spikes: a.spikes },
    defenderSide: { ...d.flags, spikes: d.spikes },
  });
  const move = new smogon.Move(gen, c.move, { isCrit: f.crit, useZ: a.zMove || undefined, useMax: a.dynamaxed || undefined, hits: a.hits || undefined });
  return smogon.calculate(gen, mk(a), mk(d), move, field);
}

const EV = (o: Partial<CalcSide["evs"]>) => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...o });
const B = (o: Partial<CalcSide["boosts"]>) => ({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...o });
const PHYS = { nature: "Adamant", evs: EV({ atk: 252, spe: 252 }) };
const SPEC = { nature: "Modest", evs: EV({ spa: 252, spe: 252 }) };
const BULK = { nature: "Bold", evs: EV({ hp: 252, def: 252 }) };

const CASES: Case[] = [
  // Gen 3
  { name: "g3 Choice Band Salamence EQ", gen: 3, a: { species: "Salamence", ...PHYS, item: "Choice Band", ability: "Intimidate" }, d: { species: "Swampert", ...BULK }, move: "Earthquake" },
  { name: "g3 sand Rock Slide spread", gen: 3, a: { species: "Tyranitar", ...PHYS }, d: { species: "Gengar" }, move: "Rock Slide", field: { gameType: "Doubles", weather: "Sand" } },
  { name: "g3 burned Explosion", gen: 3, a: { species: "Metagross", ...PHYS, status: "brn" }, d: { species: "Blissey", ...BULK }, move: "Explosion" },
  { name: "g3 Thick Fat Ice Beam", gen: 3, a: { species: "Starmie", ...SPEC }, d: { species: "Snorlax", ability: "Thick Fat" }, move: "Ice Beam" },
  { name: "g3 crit", gen: 3, a: { species: "Heracross", ...PHYS }, d: { species: "Skarmory", ...BULK }, move: "Megahorn", field: { crit: true } },
  // Gen 4
  { name: "g4 Life Orb Close Combat crit", gen: 4, a: { species: "Lucario", ...PHYS, item: "Life Orb" }, d: { species: "Tyranitar", ...BULK }, move: "Close Combat", field: { crit: true } },
  { name: "g4 hail Blizzard spread", gen: 4, a: { species: "Abomasnow", ...SPEC }, d: { species: "Garchomp" }, move: "Blizzard", field: { gameType: "Doubles", weather: "Hail" } },
  { name: "g4 Night Shade fixed", gen: 4, a: { species: "Blissey" }, d: { species: "Gengar" }, move: "Night Shade" },
  { name: "g4 Technician Bullet Seed", gen: 4, a: { species: "Breloom", ...PHYS, ability: "Technician" }, d: { species: "Swampert", ...BULK }, move: "Bullet Seed" },
  { name: "g4 Bullet Seed 5 hits", gen: 4, a: { species: "Breloom", ...PHYS, hits: 5 }, d: { species: "Swampert", ...BULK }, move: "Bullet Seed" },
  // Gen 5
  { name: "g5 sun Heat Wave spread", gen: 5, a: { species: "Ninetales", ...SPEC, ability: "Drought" }, d: { species: "Scizor" }, move: "Heat Wave", field: { gameType: "Doubles", weather: "Sun" } },
  { name: "g5 Reflect + Helping Hand", gen: 5, a: { species: "Excadrill", ...PHYS, flags: { isHelpingHand: true } }, d: { species: "Heatran", ...BULK, flags: { isReflect: true } }, move: "Iron Head" },
  { name: "g5 Normal Gem", gen: 5, a: { species: "Dragonite", ...PHYS, item: "Normal Gem" }, d: { species: "Ferrothorn", ...BULK }, move: "Extreme Speed" },
  { name: "g5 Seismic Toss L50", gen: 5, a: { species: "Chansey", level: 50 }, d: { species: "Tyranitar" }, move: "Seismic Toss" },
  // Gen 6
  { name: "g6 Mega Kangaskhan Parental Bond", gen: 6, a: { species: "Kangaskhan-Mega", ...PHYS, ability: "Parental Bond", item: "Kangaskhanite" }, d: { species: "Landorus-Therian", ...BULK }, move: "Return" },
  { name: "g6 Mega Charizard X", gen: 6, a: { species: "Charizard-Mega-X", ...PHYS, item: "Charizardite X", ability: "Tough Claws" }, d: { species: "Azumarill", ...BULK }, move: "Flare Blitz" },
  { name: "g6 Pixilate Hyper Voice spread", gen: 6, a: { species: "Sylveon", ...SPEC, ability: "Pixilate" }, d: { species: "Hydreigon" }, move: "Hyper Voice", field: { gameType: "Doubles" } },
  { name: "g6 Fairy Aura", gen: 6, a: { species: "Xerneas", ...SPEC }, d: { species: "Yveltal" }, move: "Moonblast", field: { flags: { isFairyAura: true } } },
  // Gen 7
  { name: "g7 Z Gigavolt Havoc", gen: 7, a: { species: "Tapu Koko", ...SPEC, item: "Electrium Z", zMove: true }, d: { species: "Celesteela", ...BULK }, move: "Thunderbolt" },
  { name: "g7 Z from Flare Blitz", gen: 7, a: { species: "Incineroar", ...PHYS, item: "Firium Z", zMove: true }, d: { species: "Kartana" }, move: "Flare Blitz" },
  { name: "g7 Psychic Terrain", gen: 7, a: { species: "Tapu Lele", ...SPEC, ability: "Psychic Surge" }, d: { species: "Toxapex", ...BULK }, move: "Psychic", field: { terrain: "Psychic" } },
  { name: "g7 Aurora Veil", gen: 7, a: { species: "Garchomp", ...PHYS }, d: { species: "Ninetales-Alola", flags: { isAuroraVeil: true } }, move: "Earthquake", field: { weather: "Hail" } },
  { name: "g7 Mega Mawile", gen: 7, a: { species: "Mawile-Mega", ...PHYS, ability: "Huge Power", item: "Mawilite" }, d: { species: "Magearna", ...BULK }, move: "Play Rough" },
  // Gen 8
  { name: "g8 Dynamax attacker", gen: 8, a: { species: "Dragapult", ...PHYS, dynamaxed: true }, d: { species: "Ferrothorn", ...BULK }, move: "Dragon Darts" },
  { name: "g8 Dynamaxed defender", gen: 8, a: { species: "Urshifu", ...PHYS }, d: { species: "Gyarados", dynamaxed: true }, move: "Wicked Blow" },
  { name: "g8 Expanding Force spread", gen: 8, a: { species: "Indeedee-F", ...SPEC }, d: { species: "Rillaboom" }, move: "Expanding Force", field: { gameType: "Doubles", terrain: "Psychic" } },
  { name: "g8 Grassy Glide", gen: 8, a: { species: "Rillaboom", ...PHYS, ability: "Grassy Surge", item: "Choice Band" }, d: { species: "Toxapex", ...BULK }, move: "Grassy Glide", field: { terrain: "Grassy" } },
  { name: "g8 Body Press", gen: 8, a: { species: "Corviknight", ...BULK }, d: { species: "Tyranitar" }, move: "Body Press" },
  { name: "g8 Light Screen doubles", gen: 8, a: { species: "Togekiss", ...SPEC }, d: { species: "Excadrill", flags: { isLightScreen: true } }, move: "Dazzling Gleam", field: { gameType: "Doubles" } },
  // Gen 9
  { name: "g9 Tera Fire Specs", gen: 9, a: { species: "Iron Moth", ...SPEC, item: "Choice Specs", teraType: "Fire", terastallized: true }, d: { species: "Gholdengo" }, move: "Fiery Dance" },
  { name: "g9 Tera Stellar Terapagos", gen: 9, a: { species: "Terapagos-Stellar", ...SPEC, teraType: "Stellar", terastallized: true }, d: { species: "Kingambit", ...BULK }, move: "Tera Starstorm" },
  { name: "g9 Tera Stellar off-type", gen: 9, a: { species: "Dragonite", ...PHYS, teraType: "Stellar", terastallized: true }, d: { species: "Garchomp" }, move: "Earthquake" },
  { name: "g9 Tera Blast Normal", gen: 9, a: { species: "Dragonite", ...PHYS, teraType: "Normal", terastallized: true }, d: { species: "Corviknight", ...BULK }, move: "Tera Blast" },
  { name: "g9 Population Bomb", gen: 9, a: { species: "Maushold", ...PHYS, ability: "Technician", item: "Wide Lens" }, d: { species: "Great Tusk" }, move: "Population Bomb" },
  { name: "g9 Sword of Ruin", gen: 9, a: { species: "Chien-Pao", ...PHYS, ability: "Sword of Ruin" }, d: { species: "Kingambit", ...BULK }, move: "Icicle Crash", field: { flags: { isSwordOfRuin: true } } },
  { name: "g9 snow Ice-type Def", gen: 9, a: { species: "Garchomp", ...PHYS }, d: { species: "Baxcalibur", ...BULK }, move: "Earthquake", field: { weather: "Snow" } },
  { name: "g9 Protosynthesis", gen: 9, a: { species: "Flutter Mane", ...SPEC, ability: "Protosynthesis", item: "Booster Energy", abilityOn: true }, d: { species: "Amoonguss", ...BULK }, move: "Moonblast", field: { weather: "Sun" } },
  { name: "g9 Super Fang", gen: 9, a: { species: "Raticate" }, d: { species: "Dondozo", hpPercent: 60 }, move: "Super Fang" },
  { name: "g9 Ruination", gen: 9, a: { species: "Ting-Lu" }, d: { species: "Gholdengo" }, move: "Ruination" },
  { name: "g9 crit ignores screen and +Def", gen: 9, a: { species: "Kingambit", ...PHYS, boosts: B({ atk: 2 }) }, d: { species: "Gholdengo", flags: { isReflect: true }, boosts: B({ def: 2 }) }, move: "Kowtow Cleave", field: { crit: true } },
  { name: "g9 Guts Facade burned", gen: 9, a: { species: "Ursaluna", ...PHYS, ability: "Guts", item: "Flame Orb", status: "brn" }, d: { species: "Toxapex", ...BULK }, move: "Facade" },
  { name: "g9 burned no Guts", gen: 9, a: { species: "Garchomp", ...PHYS, status: "brn" }, d: { species: "Toxapex", ...BULK }, move: "Earthquake" },
  { name: "g9 Helping Hand spread", gen: 9, a: { species: "Flutter Mane", ...SPEC, flags: { isHelpingHand: true } }, d: { species: "Incineroar" }, move: "Dazzling Gleam", field: { gameType: "Doubles" } },
  { name: "g9 Hydro Steam in sun", gen: 9, a: { species: "Volcanion", ...SPEC }, d: { species: "Garchomp" }, move: "Hydro Steam", field: { weather: "Sun" } },
  { name: "g9 VGC Surging Strikes", gen: 9, a: { species: "Urshifu-Rapid-Strike", level: 50, ...PHYS, item: "Mystic Water" }, d: { species: "Amoonguss", level: 50, ...BULK }, move: "Surging Strikes" },
  { name: "g9 -1 Atk", gen: 9, a: { species: "Garchomp", ...PHYS, boosts: B({ atk: -1 }) }, d: { species: "Incineroar" }, move: "Earthquake" },
  { name: "g9 Multiscale full HP", gen: 9, a: { species: "Baxcalibur", ...PHYS }, d: { species: "Dragonite", ability: "Multiscale" }, move: "Icicle Crash" },
  { name: "g9 Multiscale half HP", gen: 9, a: { species: "Baxcalibur", ...PHYS }, d: { species: "Dragonite", ability: "Multiscale", hpPercent: 50 }, move: "Icicle Crash" },
  { name: "g9 Stealth Rock + Spikes KO text", gen: 9, a: { species: "Kingambit", ...PHYS }, d: { species: "Volcarona", flags: { isSR: true }, spikes: 2 }, move: "Iron Head" },
  { name: "g9 Electric Terrain", gen: 9, a: { species: "Iron Hands", ...PHYS }, d: { species: "Gyarados" }, move: "Wild Charge", field: { terrain: "Electric" } },
  { name: "g9 Misty Terrain Dragon", gen: 9, a: { species: "Roaring Moon", ...PHYS }, d: { species: "Garchomp" }, move: "Outrage", field: { terrain: "Misty" } },
];

describe("damage calculator matches @smogon/calc", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const ref = theirs(c);
      const ours = calcMoves({ gen: gens.get(c.gen), lib: adaptable }, { ...side(c.a), moves: [c.move] }, side(c.d), { ...emptyField(), ...c.field })[0];
      expect(ours, `no line for ${c.move}`).toBeTruthy();
      expect(ours.damage).toEqual(ref.range());
      if (ref.range()[1] > 0) {
        expect(ours.ko).toBe(ref.kochance(false).text);
        expect(ours.desc).toBe(ref.fullDesc("%", false));
      }
    });
  }
});
