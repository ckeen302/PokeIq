import { TYPES, capitalize, effectiveness, type PokemonType } from "@/lib/pokemon/type-matrix";
import { POKEDEX, type Pokemon } from "@/lib/pokemon/pokedex";
import { MOVES } from "./data";
import type { MoveRecord } from "./build";

/** Everything on a /pokedex/types/[type] page, derived only from the type matrix, the Pokédex and the move data. */

export function isType(t: string): t is PokemonType {
  return (TYPES as readonly string[]).includes(t);
}

export interface TypeMatchups {
  /** This type attacking. */
  superEffective: PokemonType[];
  notVeryEffective: PokemonType[];
  noEffect: PokemonType[];
  /** This type defending (mono-typed). */
  weakTo: PokemonType[];
  resists: PokemonType[];
  immuneTo: PokemonType[];
}

export function typeMatchups(t: PokemonType): TypeMatchups {
  const att = (m: number) => TYPES.filter((d) => effectiveness(t, [d]) === m);
  const def = (m: number) => TYPES.filter((a) => effectiveness(a, [t]) === m);
  return { superEffective: att(2), notVeryEffective: att(0.5), noEffect: att(0), weakTo: def(2), resists: def(0.5), immuneTo: def(0) };
}

export function pokemonOfType(t: PokemonType): { pure: Pokemon[]; dual: Pokemon[] } {
  const all = POKEDEX.filter((p) => p.types.includes(t));
  return { pure: all.filter((p) => p.types.length === 1), dual: all.filter((p) => p.types.length > 1) };
}

export interface TypeMoves {
  total: number;
  physical: number;
  special: number;
  status: number;
  /** Highest base power first (ties: more learners, then name). */
  strongest: MoveRecord[];
  /** Learned by the most Pokémon. */
  common: MoveRecord[];
}

export function movesOfType(t: PokemonType, limit = 10): TypeMoves {
  const list = MOVES.filter((m) => m.type === t);
  const count = (cls: string) => list.filter((m) => m.cls === cls).length;
  const strongest = list
    .filter((m) => m.cls !== "status" && m.power !== null)
    .sort((a, b) => (b.power ?? 0) - (a.power ?? 0) || b.learners.length - a.learners.length || a.name.localeCompare(b.name))
    .slice(0, limit);
  const common = list
    .filter((m) => m.learners.length > 0)
    .sort((a, b) => b.learners.length - a.learners.length || a.name.localeCompare(b.name))
    .slice(0, limit);
  return { total: list.length, physical: count("physical"), special: count("special"), status: count("status"), strongest, common };
}

export function typeTitle(t: PokemonType): string {
  return `${capitalize(t)} Type Pokémon: Weaknesses, Strengths & Moves`;
}

export function typeDescription(t: PokemonType): string {
  const m = typeMatchups(t);
  const { pure, dual } = pokemonOfType(t);
  const list = (ts: PokemonType[]) => ts.map(capitalize).join(", ");
  return (
    `${capitalize(t)} moves are super effective against ${m.superEffective.length ? list(m.superEffective) : "no type"}. ` +
    `${capitalize(t)}-type Pokémon are weak to ${m.weakTo.length ? list(m.weakTo) : "nothing"}. ` +
    `All ${pure.length + dual.length} ${capitalize(t)}-type Pokémon and the strongest ${capitalize(t)} moves.`
  );
}
