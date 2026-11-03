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
import { DamageTable, neutralState, type HitState } from "../src/lib/mass-battle/damage";
import { Battle, expectedDamage, expectedHits, hitChance, prepare, setStages, type Prepared } from "../src/lib/mass-battle/engine";
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
];

const TURNS = 60;
const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const roster = buildRoster();
const bySlug = new Map(roster.species.map((s) => [s.slug, s]));

function specOf(m: Matchup, level: number, seed: number): BattleSpec {
  const side = (rows: Side) => ({ formation: "line" as const, units: rows.map(([slug, count, set]) => ({ id: bySlug.get(slug)!.id, count, ...(set ? { set } : {}) })) });
  return { sides: [side(m.a), side(m.b)], level, arena: "plains", seed, items: m.items, field: m.field };
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** Each level plays its own battles (their outcomes would otherwise be nearly the same, and the rows not independent); --offset moves to fresh ones. */
let seedOffset = 0;
const seedBase = (level: number) => level * 100_000 + seedOffset;

function engineRate(prep: Prepared, table: DamageTable, runs: number, layout: "melee" | "field", level: number): { wins: number; draws: number } {
  let wins = 0, draws = 0;
  for (let k = 0; k < runs; k++) {
    const b = new Battle({ ...prep, seed: 7_000_000 + seedBase(level) + k, layout }, table);
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
    const ph = (): PokemonSet => ({ name: PLACEHOLDER, species: "Magikarp", item: "", ability: "Rattled", moves: ["Splash"], nature: "Hardy", gender: "", evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 1 } as PokemonSet);
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

function simHitState(table: DamageTable, af: number, df: number, a: SimPokemon, d: SimPokemon, mv: Prepared["moves"][number][number], spread: boolean): HitState {
  const st = neutralState(a.maxhp, d.maxhp);
  st.aForm = formIndex(table, af, a);
  st.dForm = formIndex(table, df, d);
  st.aSlow = !!a.volatiles["slowstart"];
  st.spread = spread;
  st.aHp = a.hp;
  st.dHp = d.hp;
  setStages(st, mv, a.boosts.atk, a.boosts.def, a.boosts.spa, d.boosts.atk, d.boosts.def, d.boosts.spd);
  st.aStatus = STATUS_OF[a.status] ?? 0;
  st.dStatus = STATUS_OF[d.status] ?? 0;
  st.aItem = !!a.item;
  st.dItem = !!d.item;
  return st;
}

/** One simulator battle with the engine's policy on both sides; returns the winner (0, 1, or 2 for a draw). */
export function simBattle(prep: Prepared, table: DamageTable, seedIndex: number, inspect?: (battle: SimBattle) => void): 0 | 1 | 2 {
  const active = Math.max(prep.armies[0].reduce((a, [, c]) => a + c, 0), prep.armies[1].reduce((a, [, c]) => a + c, 0));
  const { sets, units } = teamsOf(prep, active);
  const battle = new SimBattle({ ...formatFor(active), seed: battleSeed("mass-battle-crosscheck", seedIndex) } as ConstructorParameters<typeof SimBattle>[0]);
  battle.setPlayer("p1", { name: "Side A", team: Teams.pack(sets[0]) });
  battle.setPlayer("p2", { name: "Side B", team: Teams.pack(sets[1]) });
  for (const side of battle.sides) {
    const req = side.activeRequest as { teamPreview?: boolean } | null;
    if (req?.teamPreview) battle.choose(side.id, `team ${sets[side.n].map((_, i) => i + 1).join("")}`);
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
  // The battle's field, for the whole battle (as the engine has it).
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
  const unitOf = new Map<string, SimUnit>();
  for (const s of [0, 1]) for (const u of units[s]) unitOf.set(`${s}|${u.name}`, u);
  const foeOrder = (s: number) => units[1 - s].map((u) => battle.sides[1 - s].pokemon.find((p) => p.name === u.name)!);
  const field = prep.field;
  const choose = (s: number): string => {
    const side = battle.sides[s];
    const req = side.activeRequest as { forceSwitch?: boolean[]; active?: { moves: { id: string; disabled?: boolean | string }[]; canTerastallize?: string }[] } | null;
    if (!req) return "default";
    if (req.forceSwitch) return req.forceSwitch.map(() => "pass").join(", ");
    const parts: string[] = [];
    side.active.forEach((p, slot) => {
      const me = p && !p.fainted && p.name !== PLACEHOLDER ? unitOf.get(`${s}|${p.name}`) : undefined;
      const options = req.active?.[slot];
      if (!p || !me || !options) return parts.push("pass");
      const foes = foeOrder(s).filter((f) => f && !f.fainted && f.hp > 0);
      const target = foes.find((f) => table.canDamage(me.fighter, unitOf.get(`${1 - s}|${f.name}`)!.fighter)) ?? foes[0];
      const moves = prep.moves[me.fighter];
      const expected = (slotIdx: number, foe: SimPokemon, spread: boolean) => {
        const mv = moves[slotIdx];
        const df = unitOf.get(`${1 - s}|${foe.name}`)!.fighter;
        const chance = hitChance({ mv, aAbility: toId(p.ability), aItem: toId(p.item), dAbility: toId(foe.ability), dItem: toId(foe.item), accStage: p.boosts.accuracy, evaStage: foe.boosts.evasion, weather: field.weather, targetMoved: false });
        return expectedDamage(table, me.fighter, slotIdx, df, simHitState(table, me.fighter, df, p, foe, mv, spread), chance, expectedHits(mv, toId(p.ability), toId(p.item)), foe.hp);
      };
      // The simulator's own list of what it may use (a lock leaves one move): matched to the set's slots by id.
      const optionOf = (m: number) => options.moves.findIndex((o) => o.id === toId(moves[m].name) && !o.disabled);
      let best = -1, bestV = 0;
      for (let m = 0; m < moves.length; m++) {
        if (optionOf(m) < 0) continue;
        const mv = moves[m];
        let v = 0;
        if (mv.spread && foes.length >= 2) for (const f of foes) v += expected(m, f, true);
        else if (target) v = expected(m, target, false);
        if (v > bestV) { bestV = v; best = m; }
      }
      let choice = best >= 0 ? optionOf(best) : -1;
      if (choice < 0) {
        // Nothing it has does damage (or it's locked into something else): the first move it may use.
        choice = Math.max(0, options.moves.findIndex((o) => !o.disabled));
        best = moves.findIndex((m) => toId(m.name) === options.moves[choice]?.id);
      }
      const mv = best >= 0 ? moves[best] : null;
      const targetPos = target ? battle.sides[1 - s].active.indexOf(target) + 1 : 1;
      const needsTarget = active > 1 && !(mv?.spread ?? false);
      // A Tera set Terastallizes as the battle starts (the engine's are Terastallized from the start).
      const tera = prep.sets[me.fighter].tera && (options as { canTerastallize?: string }).canTerastallize ? " terastallize" : "";
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
  const engine = engineRate(prep, table, runs, "melee", level);
  const field = engineRate(prep, table, runs, "field", level);
  let wins = 0, draws = 0;
  for (let k = 0; k < runs; k++) {
    const w = simBattle(prep, table, seedBase(level) + k);
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
