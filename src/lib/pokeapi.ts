/**
 * Unified PokéAPI client. Every call goes through lib/http (TTL cache,
 * coalescing, backoff), so hot paths cost zero network after warm-up.
 */
import { fetchJson } from "./http";
import { titleCase } from "./utils";

const BASE = "https://pokeapi.co/api/v2";
const SPRITES =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

// ---------------------------------------------------------------------------
// Response shapes (only the fields we consume)
// ---------------------------------------------------------------------------

export interface NamedRef {
  name: string;
  url: string;
}

export interface PokemonData {
  id: number;
  name: string;
  types: Array<{ slot: number; type: NamedRef }>;
  stats: Array<{ base_stat: number; stat: NamedRef }>;
  species: NamedRef;
  sprites: {
    back_default: string | null;
    front_default: string | null;
    other?: {
      "official-artwork"?: {
        front_default: string | null;
        front_shiny: string | null;
      };
    };
  };
}

export interface TypeData {
  id: number;
  name: string;
  damage_relations: {
    double_damage_from: NamedRef[];
    double_damage_to: NamedRef[];
    half_damage_from: NamedRef[];
    half_damage_to: NamedRef[];
    no_damage_from: NamedRef[];
    no_damage_to: NamedRef[];
  };
  moves: NamedRef[];
}

export interface MoveData {
  id: number;
  name: string;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
  type: NamedRef;
  damage_class: NamedRef;
  effect_entries: Array<{
    effect: string;
    short_effect: string;
    language: NamedRef;
  }>;
  flavor_text_entries: Array<{
    flavor_text: string;
    language: NamedRef;
  }>;
  learned_by_pokemon: NamedRef[];
}

interface ResourceList {
  count: number;
  results: NamedRef[];
}

// ---------------------------------------------------------------------------
// Generations & static type data
// ---------------------------------------------------------------------------

/** National dex id ranges per generation. */
export const GEN_RANGES: ReadonlyArray<readonly [number, number]> = [
  [1, 151],
  [152, 251],
  [252, 386],
  [387, 493],
  [494, 649],
  [650, 721],
  [722, 809],
  [810, 905],
  [906, 1025],
];

export const MAX_DEX_ID = 1025;

export function generationOf(id: number): number {
  for (let gen = 0; gen < GEN_RANGES.length; gen++) {
    const [lo, hi] = GEN_RANGES[gen];
    if (id >= lo && id <= hi) return gen + 1;
  }
  return 0;
}

/** The 18 battle-relevant types (excludes stellar/unknown/shadow). */
export const ALL_TYPES = [
  "normal",
  "fire",
  "water",
  "electric",
  "grass",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "steel",
  "dark",
  "fairy",
] as const;

export type TypeName = (typeof ALL_TYPES)[number];

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export function getPokemon(idOrName: number | string): Promise<PokemonData> {
  return fetchJson<PokemonData>(`${BASE}/pokemon/${idOrName}`);
}

export function getType(name: string): Promise<TypeData> {
  return fetchJson<TypeData>(`${BASE}/type/${name}`);
}

export function getMove(idOrName: number | string): Promise<MoveData> {
  return fetchJson<MoveData>(`${BASE}/move/${idOrName}`);
}

/** Names of all canonical-dex Pokémon, indexable as names[id - 1]. */
export async function getPokemonNameList(): Promise<string[]> {
  const list = await fetchJson<ResourceList>(
    `${BASE}/pokemon?limit=${MAX_DEX_ID}`,
  );
  return list.results.map((r) => r.name);
}

/** Alternate-form Pokémon entries (regional forms, megas, …), ids > 10000. */
export async function getFormList(): Promise<NamedRef[]> {
  const list = await fetchJson<ResourceList>(`${BASE}/pokemon?limit=100000`);
  return list.results.filter((r) => {
    const id = idFromUrl(r.url);
    return id !== null && id > 10000;
  });
}

/** All main-series move refs (ids ≤ 919; excludes shadow/glitch entries). */
export async function getMoveList(): Promise<NamedRef[]> {
  const list = await fetchJson<ResourceList>(`${BASE}/move?limit=2000`);
  return list.results.filter((r) => {
    const id = idFromUrl(r.url);
    return id !== null && id <= 919;
  });
}

export function idFromUrl(url: string): number | null {
  const match = url.match(/\/(\d+)\/?$/);
  return match ? Number(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Sprite URL helpers (deterministic GitHub CDN paths)
// ---------------------------------------------------------------------------

export function officialArtworkUrl(id: number): string {
  return `${SPRITES}/other/official-artwork/${id}.png`;
}

export function shinyArtworkUrl(id: number): string {
  return `${SPRITES}/other/official-artwork/shiny/${id}.png`;
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

export function displayName(slug: string): string {
  return titleCase(slug);
}

export function baseStat(pokemon: PokemonData, statName: string): number {
  const entry = pokemon.stats.find((s) => s.stat.name === statName);
  return entry ? entry.base_stat : 0;
}

export function statTotal(pokemon: PokemonData): number {
  return pokemon.stats.reduce((sum, s) => sum + s.base_stat, 0);
}

export function typeNames(pokemon: PokemonData): string[] {
  return [...pokemon.types]
    .sort((a, b) => a.slot - b.slot)
    .map((t) => t.type.name);
}

/**
 * Full defensive type chart: matrix[attacker][defender] = multiplier.
 * Built once from the 18 type endpoints; cached by the HTTP layer.
 */
export async function getTypeChart(): Promise<
  Record<string, Record<string, number>>
> {
  const types = await Promise.all(ALL_TYPES.map((t) => getType(t)));
  const matrix: Record<string, Record<string, number>> = {};
  for (const attacker of ALL_TYPES) {
    matrix[attacker] = {};
    for (const defender of ALL_TYPES) matrix[attacker][defender] = 1;
  }
  for (const type of types) {
    const rel = type.damage_relations;
    for (const d of rel.double_damage_to) matrix[type.name][d.name] = 2;
    for (const d of rel.half_damage_to) matrix[type.name][d.name] = 0.5;
    for (const d of rel.no_damage_to) matrix[type.name][d.name] = 0;
  }
  return matrix;
}

/** Combined defensive multiplier against `attacker` for a (mono/dual) typing. */
export function defensiveMultiplier(
  chart: Record<string, Record<string, number>>,
  attacker: string,
  defenderTypes: string[],
): number {
  return defenderTypes.reduce(
    (mult, def) => mult * (chart[attacker]?.[def] ?? 1),
    1,
  );
}
