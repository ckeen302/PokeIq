/**
 * The Mass Battle engine against Pokémon Showdown's simulator.
 *
 *   npx tsx scripts/mass-battle-crosscheck.ts [--runs 200] [--only id,id] [--offset n] [--json out.json] [--sets]
 *
 * For small battles (1 v 1, 2 v 1, 1 v 2, 3 v 1) at levels 50 and 100, the
 * same sets (the battle's own: moves, ability, item, nature, EVs, IVs) are
 * played many times in the engine and in @pkmn/sim (the browser build of
 * Showdown's simulator the Battle Lab runs on: singles, doubles, and gen 9
 * rules in a triple battle with the one Pokémon in the middle, next to all
 * three foes), and the win rates compared.
 *
 * Both sides of the comparison play by the same rules of choice, so only
 * the battle mechanics differ:
 * - The engine runs in its "melee" layout: everyone in reach of everyone
 *   from the start and nobody moves (the battlefield, the page's own
 *   addition, is left out).
 * - The simulator's players are the engine's own policy: each Pokémon aims
 *   at the first foe standing that it can hurt and picks, as the turn
 *   starts, the move with the most expected damage (the engine's
 *   expectedDamage on the engine's damage table, over every foe a spread
 *   move would hit), with the simulator's own HP, stat stages, status and
 *   items. No switching, no Tera unless the set has it.
 *
 * Each row reports both win rates with 95% intervals (Wilson), their
 * difference and a two-proportion z score; |z| < 2 is agreement within
 * the noise of that many battles. The field-layout column is the engine on
 * the page's battlefield, for the effect of positioning.
 */
import { writeFileSync } from "node:fs";
import { Battle as SimBattle, Dex as SimDex, Teams, type PokemonSet } from "@pkmn/sim";
import { battleSeed } from "../src/lib/battle/lab/seed";
import { DamageTable } from "../src/lib/mass-battle/damage";
import { Battle, prepare, type Prepared } from "../src/lib/mass-battle/engine";
import { buildRoster } from "../src/lib/mass-battle/roster-data";
import { STATUS, type BattleSpec, type FieldSpec, type ItemPolicy, type SetChoice } from "../src/lib/mass-battle/types";

type Side = [slug: string, count: number, set?: SetChoice][];
interface Matchup {
  id: string;
  /** Row label. */
  label: string;
  a: Side;
  b: Side;
  items?: ItemPolicy;
  field?: FieldSpec;
  levels?: number[];
  /** The simulator's format when a side has more than three: doubles or triples (the rest wait and come in as others faint). */
  format?: "doubles" | "triples";
  /** Friendly fire off (it's on by default, as in the simulator's doubles and triples). */
  noFriendlyFire?: boolean;
}

/** The matchups: the page's headline ones, and others chosen for close results and a spread of mechanics. */
export const MATCHUPS: Matchup[] = [
  // Close fights, found by searching for matchups near 50% (fully evolved random-battle sets).
  { id: "azumarill-vileplume", label: "Azumarill vs Vileplume", a: [["azumarill", 1]], b: [["vileplume", 1]] },
  { id: "samurott-armarouge", label: "Samurott vs Armarouge", a: [["samurott", 1]], b: [["armarouge", 1]] },
  { id: "charizard-armarouge", label: "Charizard vs Armarouge", a: [["charizard", 1]], b: [["armarouge", 1]] },
  { id: "hitmonlee-yanmega", label: "Hitmonlee vs Yanmega", a: [["hitmonlee", 1]], b: [["yanmega", 1]] },
  { id: "primarina-sylveon", label: "Primarina vs Sylveon", a: [["primarina", 1]], b: [["sylveon", 1]] },
  { id: "yanmega2-pyroar", label: "2 Yanmega vs Pyroar", a: [["yanmega", 2]], b: [["pyroar", 1]] },
  { id: "flareon2-cloyster", label: "2 Flareon vs Cloyster", a: [["flareon", 2]], b: [["cloyster", 1]] },
  { id: "maushold-meowstic2", label: "Maushold vs 2 Meowstic", a: [["maushold", 1]], b: [["meowstic", 2]] },
  { id: "delphox-exeggutor2", label: "Delphox vs 2 Exeggutor", a: [["delphox", 1]], b: [["exeggutor", 2]] },
  { id: "lilligant3-revavroom", label: "3 Lilligant vs Revavroom", a: [["lilligant", 3]], b: [["revavroom", 1]] },
  { id: "poliwrath3-bruxish", label: "3 Poliwrath vs Bruxish", a: [["poliwrath", 3]], b: [["bruxish", 1]] },
  // The headline matchups, small.
  { id: "rattata3-mewtwo", label: "3 Rattata vs Mewtwo", a: [["rattata", 3]], b: [["mewtwo", 1]] },
  { id: "pikachu2-static-snorlax", label: "2 Pikachu (Static) vs Snorlax", a: [["pikachu", 2, { ability: "Static" }]], b: [["snorlax", 1]] },
  // A known gap: in a double battle Lightning Rod draws each Pikachu's Volt Tackle into its partner; the engine has no allies' moves.
  { id: "pikachu2-snorlax", label: "2 Pikachu (Lightning Rod) vs Snorlax", a: [["pikachu", 2]], b: [["snorlax", 1]] },
  { id: "pikachu-snorlax-items", label: "Pikachu vs Snorlax, random-battle items", a: [["pikachu", 1]], b: [["snorlax", 1]], items: "sets" },
  { id: "magikarp3-arceus", label: "3 Magikarp vs Arceus", a: [["magikarp", 3]], b: [["arceus", 1]] },
  // Terastallized from the start (Azumarill loses its Fairy type, so Sludge Bomb is no longer super effective).
  { id: "azumarill-tera-vileplume", label: "Azumarill (Tera Water) vs Vileplume", a: [["azumarill", 1, { tera: "Water" }]], b: [["vileplume", 1]] },
  // The field through the damage calculator and the end of each turn.
  { id: "garchomp-tyranitar-sand", label: "Garchomp vs Tyranitar in a sandstorm", a: [["garchomp", 1]], b: [["tyranitar", 1]], field: { weather: "sand", terrain: "none", time: "day" } },
  // Abilities that change how a Pokémon fights as the battle goes (each opponent found by searching for a close fight).
  { id: "slaking-typhlosion", label: "Slaking (Truant) vs Typhlosion", a: [["slaking", 1]], b: [["typhlosion", 1]] },
  { id: "regigigas-honchkrow", label: "Regigigas (Slow Start) vs Honchkrow", a: [["regigigas", 1]], b: [["honchkrow", 1]] },
  { id: "aegislash-conkeldurr", label: "Aegislash (Stance Change) vs Conkeldurr", a: [["aegislash", 1]], b: [["conkeldurr", 1]] },
  { id: "wishiwashi-glalie", label: "Wishiwashi (Schooling) vs Glalie", a: [["wishiwashi", 1]], b: [["glalie", 1]] },
  { id: "minior-sylveon", label: "Minior (Shields Down) vs Sylveon", a: [["minior", 1]], b: [["sylveon", 1]] },
  { id: "eiscue-hitmonchan", label: "Eiscue (Ice Face) vs Hitmonchan", a: [["eiscue", 1]], b: [["hitmonchan", 1]] },
  { id: "mimikyu-samurott", label: "Mimikyu (Disguise) vs Samurott", a: [["mimikyu", 1]], b: [["samurott", 1]] },
  { id: "greninja-samurott", label: "Greninja (Protean) vs Samurott", a: [["greninja", 1]], b: [["samurott", 1]] },
  { id: "cinderace-charizard", label: "Cinderace (Libero) vs Charizard", a: [["cinderace", 1]], b: [["charizard", 1]] },
  { id: "okidogi-kingdra", label: "Okidogi (Toxic Chain) vs Kingdra", a: [["okidogi", 1]], b: [["kingdra", 1]] },
  { id: "pecharunt-charizard", label: "Pecharunt (Poison Puppeteer) vs Charizard", a: [["pecharunt", 1]], b: [["charizard", 1]] },
  { id: "excadrill-avalugg", label: "Excadrill (Mold Breaker) vs Avalugg (Sturdy)", a: [["excadrill", 1]], b: [["avalugg", 1]] },
  { id: "cloyster-skarmory", label: "Cloyster (Skill Link) vs Skarmory (Sturdy)", a: [["cloyster", 1]], b: [["skarmory", 1]] },
  { id: "zacian-bronzong", label: "Zacian (Intrepid Sword) vs Bronzong", a: [["zacian", 1]], b: [["bronzong", 1]] },
  { id: "great-tusk-haxorus-sun", label: "Great Tusk (Protosynthesis) vs Haxorus in harsh sunlight", a: [["great-tusk", 1]], b: [["haxorus", 1]], field: { weather: "sun", terrain: "none", time: "day" } },
  { id: "iron-bundle-delphox-electric", label: "Iron Bundle (Quark Drive) vs Delphox on Electric Terrain", a: [["iron-bundle", 1]], b: [["delphox", 1]], field: { weather: "none", terrain: "electric", time: "day" } },
  // Status moves (random-battle sets keep theirs). Opponents found by searching for close fights.
  { id: "gyarados-dd-tyranitar", label: "Gyarados (Dragon Dance) vs Tyranitar", a: [["gyarados", 1, { moves: ["Dragon Dance", "Waterfall", "Earthquake", "Temper Flare"], ability: "Moxie" }]], b: [["tyranitar", 1]] },
  { id: "calmmind-suicune-lanturn", label: "Suicune (Calm Mind, Rest, Pressure) vs Lanturn", a: [["suicune", 1, { moves: ["Calm Mind", "Rest", "Scald", "Ice Beam"], ability: "Pressure" }]], b: [["lanturn", 1]] },
  { id: "weezing-wisp-garchomp", label: "Galarian Weezing (Will-O-Wisp) vs Garchomp", a: [["weezing-galar", 1]], b: [["garchomp", 1]] },
  { id: "toxic-clefable-furret", label: "Clefable (Toxic, Moonlight) vs Furret", a: [["clefable", 1, { moves: ["Moonblast", "Toxic", "Moonlight", "Flamethrower"] }]], b: [["furret", 1]] },
  { id: "breloom-spore-focuspunch", label: "Breloom (Spore, Focus Punch) vs Wyrdeer", a: [["breloom", 1, { moves: ["Spore", "Focus Punch", "Seed Bomb", "Rock Tomb"] }]], b: [["wyrdeer", 1]] },
  { id: "ferrothorn-leechseed-protect", label: "Ferrothorn (Leech Seed, Protect) vs Iron Valiant", a: [["ferrothorn", 1, { moves: ["Leech Seed", "Protect", "Power Whip", "Gyro Ball"] }]], b: [["iron-valiant", 1]] },
  { id: "thunderwave-blissey-empoleon", label: "Blissey (Thunder Wave, Seismic Toss, Soft-Boiled) vs Empoleon", a: [["blissey", 1]], b: [["empoleon", 1]] },
  { id: "screens-grimmsnarl-politoed", label: "Grimmsnarl (Reflect, Light Screen) vs Politoed", a: [["grimmsnarl", 1, { moves: ["Reflect", "Light Screen", "Spirit Break", "Sucker Punch"] }]], b: [["politoed", 1]] },
  { id: "rest-snorlax-machamp", label: "Snorlax (Curse, Rest) vs Machamp", a: [["snorlax", 1]], b: [["machamp", 1]] },
  // Abilities that act as a Pokémon comes in.
  { id: "pelipper-hitmontop", label: "Pelipper (Drizzle) vs Hitmontop", a: [["pelipper", 1]], b: [["hitmontop", 1]] },
  { id: "ninetales-swampert", label: "Ninetales (Drought) vs Swampert", a: [["ninetales", 1]], b: [["swampert", 1]] },
  { id: "tyranitar-volcarona", label: "Tyranitar (Sand Stream) vs Volcarona", a: [["tyranitar", 1]], b: [["volcarona", 1]] },
  { id: "abomasnow-polteageist", label: "Abomasnow (Snow Warning) vs Polteageist", a: [["abomasnow", 1]], b: [["polteageist", 1]] },
  { id: "rillaboom-krookodile", label: "Rillaboom (Grassy Surge) vs Krookodile (Intimidate)", a: [["rillaboom", 1]], b: [["krookodile", 1]] },
  { id: "gyarados-ironleaves", label: "Gyarados (Intimidate) vs Iron Leaves", a: [["gyarados", 1, { ability: "Intimidate" }]], b: [["iron-leaves", 1]] },
  { id: "gardevoir-trace-arcanine", label: "Gardevoir (Trace) vs Arcanine (Intimidate)", a: [["gardevoir", 1, { ability: "Trace" }]], b: [["arcanine", 1, { ability: "Intimidate" }]] },
  { id: "porygon2-download-gengar", label: "Porygon2 (Download) vs Gengar (Cursed Body)", a: [["porygon2", 1]], b: [["gengar", 1]] },
  { id: "weezing-gas-alomomola", label: "Weezing (Neutralizing Gas) vs Alomomola", a: [["weezing", 1, { ability: "Neutralizing Gas" }]], b: [["alomomola", 1]] },
  // Moves that charge, recharge, faint the user, do fixed damage or knock out in one hit, and the situational ones.
  { id: "venusaur-solarbeam", label: "Venusaur (Solar Beam, two turns) vs Toedscruel", a: [["venusaur", 1, { moves: ["Solar Beam", "Sludge Bomb"] }]], b: [["toedscruel", 1]] },
  { id: "garchomp-dig-excadrill", label: "Garchomp (Dig) vs Excadrill (Earthquake)", a: [["garchomp", 1, { moves: ["Dig", "Dragon Claw", "Fire Fang"] }]], b: [["excadrill", 1]] },
  // Hyper Beam has to land for the recharge turn to count: against a Ghost (Banette, in an earlier version of this row) it
  // does nothing and never recharges, so the row only measured Thunderbolt and Cursed Body (Porygon2 vs Gengar covers those).
  { id: "porygonz-hyperbeam-snorlax", label: "Porygon-Z (Hyper Beam) vs Snorlax", a: [["porygon-z", 1, { moves: ["Hyper Beam", "Thunderbolt"] }]], b: [["snorlax", 1]] },
  { id: "electrode2-gliscor", label: "2 Electrode (Explosion) vs Gliscor", a: [["electrode", 2, { moves: ["Explosion", "Thunderbolt", "Foul Play"] }]], b: [["gliscor", 1]] },
  { id: "gengar-nightshade-cloyster", label: "Gengar (Night Shade, Hypnosis, Dream Eater) vs Cloyster", a: [["gengar", 1, { moves: ["Night Shade", "Hypnosis", "Dream Eater"] }]], b: [["cloyster", 1]] },
  { id: "lapras-sheercold-garchomp", label: "Lapras (Sheer Cold) vs Garchomp", a: [["lapras", 1, { moves: ["Sheer Cold", "Freeze-Dry", "Surf"] }]], b: [["garchomp", 1]] },
  { id: "hitmontop-fakeout-plusle", label: "Hitmontop (Fake Out) vs Plusle", a: [["hitmontop", 1, { moves: ["Fake Out", "Close Combat", "Sucker Punch"] }]], b: [["plusle", 1]] },
  { id: "wobbuffet-counter-breloom", label: "Wobbuffet (Counter, Mirror Coat) vs Breloom", a: [["wobbuffet", 1]], b: [["breloom", 1]] },
  // Friendly fire: Earthquake hits a partner in Showdown's doubles; Lightning Rod pulls a partner's Volt Tackle (above).
  { id: "garchomp2-inteleon", label: "2 Garchomp (Earthquake hits the partner) vs Inteleon", a: [["garchomp", 2]], b: [["inteleon", 1]], format: "doubles" },
  // Bigger battles: the rest wait and come in as others faint (Showdown's triples and doubles). No moves that switch the
  // user out (U-turn, Flip Turn): with others waiting, the simulator switches, and this battle has no switching.
  { id: "luvdisc6-mewtwo", label: "6 Luvdisc vs Mewtwo (triples, three at a time)", a: [["luvdisc", 6, { moves: ["Hydro Pump", "Endeavor", "Whirlpool"] }]], b: [["mewtwo", 1]], format: "triples" },
  { id: "luvdisc10-arceus", label: "10 Luvdisc (Endeavor) vs Arceus (triples, three at a time)", a: [["luvdisc", 10, { moves: ["Hydro Pump", "Endeavor", "Whirlpool"] }]], b: [["arceus", 1]], format: "triples" },
  { id: "lucario6-bronzong6", label: "6 Lucario vs 6 Bronzong (doubles, two at a time)", a: [["lucario", 6]], b: [["bronzong", 6]], format: "doubles" },
];

const TURNS = 60;
const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const roster = buildRoster();
const bySlug = new Map(roster.species.map((s) => [s.slug, s]));

function specOf(m: Matchup, level: number, seed: number): BattleSpec {
  const side = (rows: Side) => ({ formation: "line" as const, units: rows.map(([slug, count, set]) => ({ id: bySlug.get(slug)!.id, count, ...(set ? { set } : {}) })) });
  return { sides: [side(m.a), side(m.b)], level, arena: "plains", seed, items: m.items, field: m.field, rules: { pp: true, friendlyFire: !m.noFriendlyFire } };
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** Each level plays its own battles (their outcomes would otherwise be nearly the same, and the rows not independent); --offset moves to fresh ones. */
let seedOffset = 0;
const seedBase = (level: number) => level * 100_000 + seedOffset;

function engineRate(prep: Prepared, table: DamageTable, runs: number, layout: "melee" | "field", level: number, slots: number): { wins: number; draws: number } {
  let wins = 0, draws = 0;
  for (let k = 0; k < runs; k++) {
    const b = new Battle({ ...prep, seed: 7_000_000 + seedBase(level) + k, layout, ...(layout === "melee" ? { active: slots } : {}) }, table);
    while (!b.ended) b.step();
    if (b.winner === 0) wins++;
    else if (b.winner === 2) draws++;
  }
  return { wins, draws };
}

// ---------------------------------------------------------------------------
// The simulator
// ---------------------------------------------------------------------------

const STATUS_OF: Record<string, number> = { par: STATUS.par, brn: STATUS.brn, psn: STATUS.psn, tox: STATUS.tox, slp: STATUS.slp, frz: STATUS.frz };
const PLACEHOLDER = "Empty Slot";

interface SimUnit {
  fighter: number;
  name: string;
}

/** The format for a battle with up to `active` Pokémon a side: Gen 9 singles, doubles, or Gen 9 rules in a triple battle. */
function formatFor(active: number) {
  if (active === 1) return { formatid: "gen9customgame" };
  if (active === 2) return { formatid: "gen9doublescustomgame" };
  const base = SimDex.formats.get("gen9customgame");
  const triples = Object.assign(Object.create(Object.getPrototypeOf(base)), base, { gameType: "triples", id: "gen9triplescustomgame", name: "[Gen 9] Triples Custom Game" });
  return { format: triples };
}

/** Each side's team in army order, padded with placeholders (faint before turn 1) so a lone Pokémon in a triple battle stands in the middle. */
function teamsOf(prep: Prepared, active: number): { sets: PokemonSet[][]; units: SimUnit[][] } {
  const sets: PokemonSet[][] = [[], []];
  const units: SimUnit[][] = [[], []];
  for (const s of [0, 1] as const) {
    const real: PokemonSet[] = [];
    let k = 0;
    for (const [f, count] of prep.armies[s]) {
      const sp = prep.species[f], set = prep.sets[f];
      for (let c = 0; c < count; c++) {
        const name = `${sp.name.slice(0, 12)} ${++k}`;
        units[s].push({ fighter: f, name });
        real.push({
          name,
          species: teamSpecies(sp.calc),
          item: set.item,
          ability: set.ability,
          moves: set.moves.map((m) => m.name),
          nature: set.nature,
          gender: "",
          evs: { ...set.evs },
          ivs: { ...set.ivs },
          level: set.level,
          teraType: set.tera || sp.types[0][0].toUpperCase() + sp.types[0].slice(1),
        } as PokemonSet);
      }
    }
    const ph = (): PokemonSet => ({ name: PLACEHOLDER, species: "Magikarp", item: "", ability: "No Ability", moves: ["Splash"], nature: "Hardy", gender: "", evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 1 } as PokemonSet);
    if (real.length >= active) sets[s] = real;
    else if (active === 3 && real.length === 1) sets[s] = [ph(), real[0], ph()];
    else sets[s] = [...real, ...Array.from({ length: active - real.length }, ph)];
  }
  return { sets, units };
}

/** The species a team brings: a battle-only form (Minior's Meteor Form, Aegislash's Blade Forme) enters as its base form and changes in battle. */
function teamSpecies(calc: string): string {
  const s = SimDex.species.get(calc);
  return s.exists ? (typeof s.battleOnly === "string" ? s.battleOnly : s.name) : calc;
}

type SimPokemon = SimBattle["sides"][number]["pokemon"][number];

/** The engine's form index (see formsOf) for a Pokémon as the simulator has it now. */
function formIndex(table: DamageTable, f: number, p: SimPokemon): number {
  const name = p.species.name;
  switch (table.rules[f]) {
    case "stance": return name === "Aegislash-Blade" ? 1 : 0;
    case "school": return name === "Wishiwashi-School" ? 1 : 0;
    case "shields": return name === "Minior-Meteor" ? 0 : 1;
    case "iceface": return name === "Eiscue-Noice" ? 1 : 0;
    case "protean": {
      const types = p.getTypes();
      if (types.length !== 1 || types.join() === table.types(f, 0).map((t) => t[0].toUpperCase() + t.slice(1)).join()) return 0;
      const k = table.formDefs[f].findIndex((d, i) => i > 0 && d.types?.[0] === types[0]);
      return Math.max(0, k);
    }
    default: return 0;
  }
}

const HIDE_OF: Record<string, number> = { fly: 1, bounce: 1, dig: 2, dive: 3, phantomforce: 4, shadowforce: 4 };
const WEATHER_OF: Record<string, FieldSpec["weather"]> = { sunnyday: "sun", desolateland: "sun", raindance: "rain", primordialsea: "rain", sandstorm: "sand", snowscape: "snow", snow: "snow" };
const TERRAIN_OF: Record<string, FieldSpec["terrain"]> = { electricterrain: "electric", grassyterrain: "grassy", psychicterrain: "psychic", mistyterrain: "misty" };

/** Pokémon a side can have on the field at once in the simulator's format for a matchup. */
export function slotsOf(m: Pick<Matchup, "format">, prep: Prepared): number {
  if (m.format === "doubles") return 2;
  if (m.format === "triples") return 3;
  return Math.min(3, Math.max(prep.armies[0].reduce((a, [, c]) => a + c, 0), prep.armies[1].reduce((a, [, c]) => a + c, 0)));
}

/**
 * One simulator battle with the engine's own plans on both sides: before each turn the simulator's battle is mirrored
 * into an engine battle (HP, status, stat stages, items, forms, PP, volatiles, the field) and planAll picks every
 * Pokémon's move and target, exactly as in the engine; returns the winner (0, 1, or 2 for a draw).
 */
export function simBattle(prep: Prepared, table: DamageTable, seedIndex: number, slots: number, inspect?: (battle: SimBattle) => void): 0 | 1 | 2 {
  const { sets, units } = teamsOf(prep, slots);
  const battle = new SimBattle({ ...formatFor(slots), seed: battleSeed("mass-battle-crosscheck", seedIndex) } as ConstructorParameters<typeof SimBattle>[0]);
  battle.setPlayer("p1", { name: "Side A", team: Teams.pack(sets[0]) });
  battle.setPlayer("p2", { name: "Side B", team: Teams.pack(sets[1]) });
  for (const side of battle.sides) {
    const req = side.activeRequest as { teamPreview?: boolean } | null;
    if (req?.teamPreview) battle.choose(side.id, `team ${sets[side.n].map((_, i) => i + 1).join(",")}`);
  }
  // The placeholders leave without a trace before turn 1.
  let changed = false;
  for (const side of battle.sides) {
    for (const p of side.pokemon) {
      if (p.name !== PLACEHOLDER) continue;
      p.hp = 0;
      p.fainted = true;
      p.isActive = false;
      p.isStarted = false;
      p.switchFlag = false;
      p.clearVolatile(false);
      side.pokemonLeft--;
      changed = true;
    }
  }
  // The battle's field, for the whole battle (as the engine has it: the picked weather and terrain are the ground state).
  const lead = battle.sides[0].active.find((p) => p && !p.fainted) ?? battle.sides[0].active[0];
  const WEATHER_ID = { none: "", sun: "sunnyday", rain: "raindance", sand: "sandstorm", snow: "snowscape" } as const;
  const TERRAIN_ID = { none: "", electric: "electricterrain", grassy: "grassyterrain", psychic: "psychicterrain", misty: "mistyterrain" } as const;
  const w = WEATHER_ID[prep.field.weather], t = TERRAIN_ID[prep.field.terrain];
  if (w && lead) {
    battle.field.setWeather(w, lead, battle.dex.moves.get(w) as never);
    battle.field.weatherState.duration = 0;
    changed = true;
  }
  if (t && lead) {
    battle.field.setTerrain(t, lead, battle.dex.moves.get(t) as never);
    battle.field.terrainState.duration = 0;
    changed = true;
  }
  if (changed) battle.makeRequest("move");
  // The engine battle that plans: the same fighters, everyone in reach of everyone.
  const mirror = new Battle({ ...prep, layout: "melee", active: slots }, table);
  const engineIndex = new Map<string, number>();
  let k = 0;
  for (const s of [0, 1]) for (const u of units[s]) engineIndex.set(`${s}|${u.name}`, k++);
  const simOf: SimPokemon[] = [];
  for (const s of [0, 1]) for (const u of units[s]) simOf.push(battle.sides[s].pokemon.find((p) => p.name === u.name)!);
  const sync = () => {
    for (let i = 0; i < simOf.length; i++) {
      const p = simOf[i];
      const f = mirror.sp[i];
      const moves = prep.moves[f];
      const vol = p.volatiles as Record<string, { move?: string; counter?: number; source?: SimPokemon; time?: number; duration?: number } | undefined>;
      const two = vol["twoturnmove"]?.move;
      const charging = two ? moves.findIndex((m) => toId(m.name) === two) : -1;
      const locked = vol["lockedmove"]?.move;
      const choice = vol["choicelock"]?.move;
      const seeder = vol["leechseed"] ? (p.volatiles["leechseed"] as { sourceSlot?: string }).sourceSlot : undefined;
      let seededBy = -1;
      if (seeder) {
        const src = battle.getAtSlot(seeder as never) as SimPokemon | null;
        if (src) seededBy = engineIndex.get(`${src.side.n}|${src.name}`) ?? -1;
      }
      const stall = vol["stall"];
      mirror.sync(i, {
        alive: !p.fainted && p.hp > 0 && p.isActive,
        hp: p.fainted ? 0 : p.hp,
        status: STATUS_OF[p.status] ?? 0,
        toxic: (p.statusState as { stage?: number }).stage ?? 0,
        stages: [p.boosts.atk, p.boosts.def, p.boosts.spa, p.boosts.spd, p.boosts.spe, p.boosts.accuracy, p.boosts.evasion],
        itemGone: !p.item,
        form: formIndex(table, f, p),
        confused: vol["confusion"] ? 2 : 0,
        protectStreak: stall?.counter ? Math.round(Math.log(stall.counter) / Math.log(3)) : 0,
        seededBy,
        charging,
        hidden: two ? HIDE_OF[two] ?? 0 : 0,
        mustRecharge: !!vol["mustrecharge"],
        hasActed: p.activeMoveActions > 0,
        rampSlot: locked ? moves.findIndex((m) => toId(m.name) === locked) : -1,
        lock: choice ? moves.findIndex((m) => toId(m.name) === choice) : -1,
        shieldUsed: (toId(p.ability) === "disguise" && p.species.name.endsWith("Busted")) || false,
        disabled: vol["disable"]?.move ? moves.findIndex((m) => toId(m.name) === vol["disable"]!.move) : -1,
        pp: moves.map((m) => p.moveSlots.find((ms) => ms.id === toId(m.name))?.pp ?? 0),
        ability: toId(p.ability),
      });
    }
    const sc = (s: number, id: string) => (battle.sides[s].sideConditions[id] ? 1 : 0);
    mirror.syncField({
      weather: WEATHER_OF[battle.field.weather] ?? "none",
      terrain: TERRAIN_OF[battle.field.terrain] ?? "none",
      screens: [0, 1].flatMap((s) => [sc(s, "reflect"), sc(s, "lightscreen"), sc(s, "auroraveil")]),
      gas: simOf.some((p) => p.isActive && !p.fainted && p.volatiles["neutralizinggas"] !== undefined),
      round: Math.max(0, battle.turn - 1),
    });
    mirror.planAll();
  };
  const choose = (s: number): string => {
    const side = battle.sides[s];
    const req = side.activeRequest as { forceSwitch?: boolean[]; active?: { moves: { id: string; disabled?: boolean | string }[]; canTerastallize?: string }[] } | null;
    if (!req) return "default";
    if (req.forceSwitch) {
      // Replacements come in in army order (as the engine's bench does).
      const used = new Set<number>();
      return req.forceSwitch.map((need) => {
        if (!need) return "pass";
        const idx = side.pokemon.findIndex((p, j) => !used.has(j) && !p.fainted && !p.isActive && p.name !== PLACEHOLDER);
        if (idx < 0) return "pass";
        used.add(idx);
        return `switch ${idx + 1}`;
      }).join(", ");
    }
    sync();
    const parts: string[] = [];
    side.active.forEach((p, slot) => {
      const me = p && !p.fainted && p.name !== PLACEHOLDER ? engineIndex.get(`${s}|${p.name}`) : undefined;
      const options = req.active?.[slot];
      if (!p || me === undefined || !options) return parts.push("pass");
      const plan = mirror.planOf(me);
      const f = mirror.sp[me];
      const moves = table.moves[f];
      const mv = plan.slot >= 0 ? moves[plan.slot] : null;
      let choice = mv ? options.moves.findIndex((o) => o.id === toId(mv.name) && !o.disabled) : -1;
      if (choice < 0) choice = Math.max(0, options.moves.findIndex((o) => !o.disabled));
      const tp = plan.target >= 0 ? simOf[plan.target] : null;
      const targetPos = tp && tp.isActive ? (tp.side === side ? -(side.active.indexOf(tp) + 1) : tp.side.active.indexOf(tp) + 1) : 1;
      const dexMove = battle.dex.moves.get(options.moves[choice]?.id ?? "");
      const needsTarget = slots > 1 && ["normal", "any", "adjacentFoe", "adjacentAlly", "adjacentAllyOrSelf"].includes(dexMove.target);
      // A Tera set Terastallizes as the battle starts (the engine's are Terastallized from the start).
      const tera = prep.sets[f].tera && options.canTerastallize ? " terastallize" : "";
      parts.push(`move ${choice + 1}${needsTarget ? ` ${targetPos}` : ""}${tera}`);
    });
    return parts.join(", ");
  };
  let guard = 0;
  while (!battle.ended && battle.turn <= TURNS && guard++ < TURNS * 8) {
    for (const side of battle.sides) {
      if (battle.ended) break;
      const req = side.activeRequest as { wait?: boolean } | null;
      if (!req || req.wait || side.isChoiceDone()) continue;
      if (!battle.choose(side.id, choose(side.n))) battle.choose(side.id, "default");
    }
  }
  inspect?.(battle);
  if (!battle.ended) return 2;
  if (battle.winner === "Side A") return 0;
  if (battle.winner === "Side B") return 1;
  return 2;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** Wilson 95% interval for k successes out of n. */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96, p = k / n;
  const den = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

/** Two-proportion z score (pooled). */
export function zScore(k1: number, n1: number, k2: number, n2: number): number {
  const p = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se === 0 ? 0 : (k1 / n1 - k2 / n2) / se;
}

// ---------------------------------------------------------------------------

export interface Row {
  id: string;
  label: string;
  level: number;
  runs: number;
  engine: { wins: number; draws: number };
  sim: { wins: number; draws: number };
  field: { wins: number; draws: number };
  z: number;
  sets: string;
}

export function crossCheck(m: Matchup, level: number, runs: number): Row {
  const prep = prepare(roster, specOf(m, level, 1), { layout: "melee" });
  const table = new DamageTable(prep.species.map((species, k) => ({ species, set: prep.sets[k] })), prep.field);
  const slots = slotsOf(m, prep);
  const engine = engineRate(prep, table, runs, "melee", level, slots);
  const field = engineRate(prep, table, runs, "field", level, slots);
  let wins = 0, draws = 0;
  for (let k = 0; k < runs; k++) {
    const w = simBattle(prep, table, seedBase(level) + k, slots);
    if (w === 0) wins++;
    else if (w === 2) draws++;
  }
  const sets = prep.species.map((s, k) => `${s.name}: ${prep.sets[k].moves.map((x) => x.name).join(", ")} / ${prep.sets[k].ability}${prep.sets[k].item ? ` @ ${prep.sets[k].item}` : ""}`).join("; ");
  return { id: m.id, label: m.label, level, runs, engine, sim: { wins, draws }, field, z: zScore(engine.wins, runs, wins, runs), sets };
}

const pct = (k: number, n: number) => `${((100 * k) / n).toFixed(1)}%`;
const ci = (k: number, n: number) => wilson(k, n).map((x) => (100 * x).toFixed(0)).join("–");

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const runs = Number(arg("--runs") ?? 200);
  seedOffset = Number(arg("--offset") ?? 0);
  const only = arg("--only")?.split(",");
  const rows: Row[] = [];
  for (const m of MATCHUPS) {
    if (only && !only.includes(m.id)) continue;
    for (const level of m.levels ?? [50, 100]) {
      const t0 = Date.now();
      const r = crossCheck(m, level, runs);
      rows.push(r);
      console.log(`${r.label} L${level}: engine ${pct(r.engine.wins, runs)} [${ci(r.engine.wins, runs)}] (${r.engine.draws} draws) · simulator ${pct(r.sim.wins, runs)} [${ci(r.sim.wins, runs)}] (${r.sim.draws} draws) · z ${r.z.toFixed(2)} · field ${pct(r.field.wins, runs)} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      if (args.includes("--sets")) console.log(`   ${r.sets}`);
    }
  }
  const agree = rows.filter((r) => Math.abs(r.z) < 2).length;
  console.log(`\n${agree} of ${rows.length} comparisons agree within |z| < 2 (${runs} battles each).`);
  const json = arg("--json");
  if (json) writeFileSync(json, JSON.stringify(rows, null, 1));
}

if (process.argv[1]?.endsWith("mass-battle-crosscheck.ts")) void main();
