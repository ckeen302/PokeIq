import type { Generation, TypeName } from "@pkmn/data";
import type { TeamSet } from "./sets";

/**
 * A team's type chart: for each of the generation's types, how each member
 * takes an attack of that type (with the abilities that change it: Levitate,
 * Flash Fire, Thick Fat and the like, and optionally as its Tera type), and
 * how well the team's own attacks hit a Pokémon of that type.
 */

const toId = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Abilities that make a type do nothing. */
const IMMUNE: Record<string, string[]> = {
  levitate: ["Ground"],
  eartheater: ["Ground"],
  flashfire: ["Fire"],
  wellbakedbody: ["Fire"],
  waterabsorb: ["Water"],
  stormdrain: ["Water"],
  dryskin: ["Water"],
  voltabsorb: ["Electric"],
  lightningrod: ["Electric"],
  motordrive: ["Electric"],
  sapsipper: ["Grass"],
};

/** Abilities that scale the damage a type does (applied to the type multiplier). */
const SCALE: Record<string, Partial<Record<string, number>>> = {
  thickfat: { Fire: 0.5, Ice: 0.5 },
  heatproof: { Fire: 0.5 },
  waterbubble: { Fire: 0.5 },
  purifyingsalt: { Ghost: 0.5 },
  dryskin: { Fire: 1.25 },
  fluffy: { Fire: 2 },
};

/** A one-line note on what an ability does to the chart, or null if nothing. */
export function abilityNote(ability: string): string | null {
  const id = toId(ability);
  if (id === "wonderguard") return "Wonder Guard: only super-effective hits land";
  const immune = IMMUNE[id];
  if (immune) return `${ability}: immune to ${immune.join(", ")}`;
  const scale = SCALE[id];
  if (scale) return `${ability}: ${Object.entries(scale).map(([t, x]) => `${t} ×${x}`).join(", ")}`;
  return null;
}

/** The generation's attacking types (no "???" or Stellar), in Showdown's order. */
export function chartTypes(gen: Generation): TypeName[] {
  return [...gen.types].map((t) => t.name).filter((t) => t !== "???" && t !== ("Stellar" as TypeName));
}

export interface MemberTyping {
  species: string;
  types: TypeName[];
  ability: string;
}

/** The types a member defends with: its Tera type when `tera` (Stellar keeps its own), else its species'. */
export function memberTyping(gen: Generation, set: TeamSet, tera: boolean): MemberTyping | null {
  const species = gen.species.get(set.species);
  if (!species) return null;
  const teraType = set.teraType && gen.types.get(set.teraType) && set.teraType !== "Stellar" ? (set.teraType as TypeName) : null;
  return { species: species.name, types: tera && teraType ? [teraType] : [...species.types], ability: gen.num >= 3 ? set.ability : "" };
}

/** How much damage an attack of `type` does to `member` (0 immune, 0.25 to 4, abilities included). */
export function defensiveMultiplier(gen: Generation, member: MemberTyping, type: TypeName): number {
  let x = gen.types.totalEffectiveness(type, member.types);
  const ability = toId(member.ability);
  if (ability === "wonderguard" && x <= 1) return 0;
  if (IMMUNE[ability]?.includes(type)) return 0;
  const scale = SCALE[ability]?.[type];
  if (scale) x *= scale;
  return x;
}

export interface AttackMove {
  name: string;
  type: TypeName;
}

/** A set's damaging moves, with their types as used (Tera Blast takes the Tera type when `tera`). */
export function attackMoves(gen: Generation, set: TeamSet, tera: boolean): AttackMove[] {
  const out: AttackMove[] = [];
  for (const name of set.moves) {
    const move = gen.moves.get(name);
    if (!move || move.category === "Status") continue;
    // Fixed-damage moves (Seismic Toss…) have no base power but still hit most types.
    if (!move.basePower && !move.damage) continue;
    let type = move.type;
    if (move.id === "terablast" && tera && set.teraType && gen.types.get(set.teraType) && set.teraType !== "Stellar") type = set.teraType as TypeName;
    out.push({ name: move.name, type });
  }
  return out;
}

/** How hard `move` hits a Pokémon of the single type `target` (Freeze-Dry, Scrappy and Mind's Eye included). */
export function offensiveMultiplier(gen: Generation, move: AttackMove, target: TypeName, ability = ""): number {
  const id = toId(move.name);
  if (id === "freezedry" && target === "Water") return 2;
  if (id === "thousandarrows" && target === "Flying") return 1;
  if (id === "flyingpress") return gen.types.totalEffectiveness("Fighting", [target]) * gen.types.totalEffectiveness("Flying", [target]);
  const x = gen.types.totalEffectiveness(move.type, [target]);
  const a = toId(ability);
  if (x === 0 && target === "Ghost" && (move.type === "Normal" || move.type === "Fighting") && (a === "scrappy" || a === "mindseye")) return 1;
  return x;
}

export interface CoverageRow {
  type: TypeName;
  /** Per member (team order): the multiplier it takes from this type; null for an unknown species. */
  taken: (number | null)[];
  weak: number;
  resist: number;
  immune: number;
  /** Per member: its best multiplier against a Pokémon of this type (0 if it has no attack). */
  dealt: number[];
  /** How many members hit this type super-effectively. */
  superEffective: number;
  /** The team's best multiplier against it. */
  best: number;
  /** The moves that hit it super-effectively ("Garchomp: Earthquake"). */
  hitters: string[];
}

export interface CoverageChart {
  types: TypeName[];
  rows: CoverageRow[];
  /** Notes on the abilities counted ("Heatran: Flash Fire: immune to Fire"). */
  notes: string[];
}

/** The team's chart. `tera`: members defend as their Tera type and Tera Blast takes it. */
export function coverageChart(gen: Generation, sets: readonly TeamSet[], opts: { tera?: boolean } = {}): CoverageChart {
  const tera = !!opts.tera && gen.num >= 9;
  const types = chartTypes(gen);
  const typings = sets.map((s) => memberTyping(gen, s, tera));
  const moves = sets.map((s) => attackMoves(gen, s, tera));
  const notes: string[] = [];
  typings.forEach((t) => {
    const note = t && t.ability ? abilityNote(t.ability) : null;
    if (t && note) notes.push(`${t.species}: ${note}`);
  });
  const rows = types.map((type): CoverageRow => {
    const taken = typings.map((t) => (t ? defensiveMultiplier(gen, t, type) : null));
    const dealt: number[] = [];
    const hitters: string[] = [];
    sets.forEach((set, i) => {
      let best = 0;
      for (const m of moves[i]) {
        const x = offensiveMultiplier(gen, m, type, gen.num >= 3 ? set.ability : "");
        if (x > 1) hitters.push(`${set.name || set.species}: ${m.name}`);
        best = Math.max(best, x);
      }
      dealt.push(best);
    });
    return {
      type,
      taken,
      weak: taken.filter((x) => x !== null && x > 1).length,
      resist: taken.filter((x) => x !== null && x > 0 && x < 1).length,
      immune: taken.filter((x) => x === 0).length,
      dealt,
      superEffective: dealt.filter((x) => x > 1).length,
      best: dealt.length ? Math.max(...dealt) : 0,
      hitters,
    };
  });
  return { types, rows, notes };
}

/** "4×", "½", "¼", "0", "1.25×"… for a chart cell. */
export function multiplierLabel(x: number): string {
  if (x === 0) return "0";
  if (x === 0.5) return "½";
  if (x === 0.25) return "¼";
  if (x === 0.125) return "⅛";
  return `${Number(x.toFixed(2))}×`;
}
