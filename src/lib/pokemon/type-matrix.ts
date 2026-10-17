/**
 * In-memory 18x18 type-effectiveness matrix.
 *
 * MATRIX[attacker][defender] holds the damage multiplier. Dual-type
 * effectiveness is the product of the two column lookups, which is exactly
 * how the games compute it — so a Ground attack vs Fire/Flying is
 * 2 (vs Fire) x 0 (vs Flying) = 0 (immune).
 *
 * Encoding this as a dense typed matrix (rather than round-tripping
 * PokéAPI's /type endpoints per question) makes effectiveness lookups O(1)
 * and lets the engine enumerate interesting matchups (4x weaknesses,
 * immunities) instantly.
 */

export const TYPES = [
  "normal", "fire", "water", "electric", "grass", "ice",
  "fighting", "poison", "ground", "flying", "psychic", "bug",
  "rock", "ghost", "dragon", "dark", "steel", "fairy",
] as const;

export type PokemonType = (typeof TYPES)[number];

const TYPE_INDEX = new Map<PokemonType, number>(TYPES.map((t, i) => [t, i]));

// Rows = attacking type, columns = defending type (order matches TYPES).
// Values: 0 = immune, 0.5 = not very effective, 1 = neutral, 2 = super effective.
// prettier-ignore
const MATRIX: readonly (readonly number[])[] = [
  //           nor  fir  wat  ele  gra  ice  fig  poi  gro  fly  psy  bug  roc  gho  dra  dar  ste  fai
  /* normal */ [1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   0.5, 0,   1,   1,   0.5, 1],
  /* fire   */ [1,   0.5, 0.5, 1,   2,   2,   1,   1,   1,   1,   1,   2,   0.5, 1,   0.5, 1,   2,   1],
  /* water  */ [1,   2,   0.5, 1,   0.5, 1,   1,   1,   2,   1,   1,   1,   2,   1,   0.5, 1,   1,   1],
  /* electr */ [1,   1,   2,   0.5, 0.5, 1,   1,   1,   0,   2,   1,   1,   1,   1,   0.5, 1,   1,   1],
  /* grass  */ [1,   0.5, 2,   1,   0.5, 1,   1,   0.5, 2,   0.5, 1,   0.5, 2,   1,   0.5, 1,   0.5, 1],
  /* ice    */ [1,   0.5, 0.5, 1,   2,   0.5, 1,   1,   2,   2,   1,   1,   1,   1,   2,   1,   0.5, 1],
  /* fight  */ [2,   1,   1,   1,   1,   2,   1,   0.5, 1,   0.5, 0.5, 0.5, 2,   0,   1,   2,   2,   0.5],
  /* poison */ [1,   1,   1,   1,   2,   1,   1,   0.5, 0.5, 1,   1,   1,   0.5, 0.5, 1,   1,   0,   2],
  /* ground */ [1,   2,   1,   2,   0.5, 1,   1,   2,   1,   0,   1,   0.5, 2,   1,   1,   1,   2,   1],
  /* flying */ [1,   1,   1,   0.5, 2,   1,   2,   1,   1,   1,   1,   2,   0.5, 1,   1,   1,   0.5, 1],
  /* psychc */ [1,   1,   1,   1,   1,   1,   2,   2,   1,   1,   0.5, 1,   1,   1,   1,   0,   0.5, 1],
  /* bug    */ [1,   0.5, 1,   1,   2,   1,   0.5, 0.5, 1,   0.5, 2,   1,   1,   0.5, 1,   2,   0.5, 0.5],
  /* rock   */ [1,   2,   1,   1,   1,   2,   0.5, 1,   0.5, 2,   1,   2,   1,   1,   1,   1,   0.5, 1],
  /* ghost  */ [0,   1,   1,   1,   1,   1,   1,   1,   1,   1,   2,   1,   1,   2,   1,   0.5, 1,   1],
  /* dragon */ [1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   1,   2,   1,   0.5, 0],
  /* dark   */ [1,   1,   1,   1,   1,   1,   0.5, 1,   1,   1,   2,   1,   1,   2,   1,   0.5, 1,   0.5],
  /* steel  */ [1,   0.5, 0.5, 0.5, 1,   2,   1,   1,   1,   1,   1,   1,   2,   1,   1,   1,   0.5, 2],
  /* fairy  */ [1,   0.5, 1,   1,   1,   1,   2,   0.5, 1,   1,   1,   1,   1,   1,   2,   2,   0.5, 1],
];

/** Multiplier for a single attacking type into a mono- or dual-typed defender. */
export function effectiveness(attacker: PokemonType, defenders: readonly PokemonType[]): number {
  const row = MATRIX[TYPE_INDEX.get(attacker)!];
  return defenders.reduce((product, def) => product * row[TYPE_INDEX.get(def)!], 1);
}

/** Full defensive profile of a (dual-)typing: attacking type -> multiplier. */
export function defensiveProfile(defenders: readonly PokemonType[]): Map<PokemonType, number> {
  const profile = new Map<PokemonType, number>();
  for (const attacker of TYPES) {
    profile.set(attacker, effectiveness(attacker, defenders));
  }
  return profile;
}

export function formatMultiplier(multiplier: number): string {
  if (multiplier === 0) return "0× (immune)";
  if (multiplier === 0.25) return "¼×";
  if (multiplier === 0.5) return "½×";
  return `${multiplier}×`;
}

export function capitalize(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
