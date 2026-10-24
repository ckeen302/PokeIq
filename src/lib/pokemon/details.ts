import "server-only";
import detailsData from "@/data/pokedex-details.json";
import movesData from "@/data/moves.json";
import { POKEDEX, evolutionFamily, getPokemon, type Pokemon, type StatKey } from "./pokedex";
import { TYPES, defensiveProfile, effectiveness, type PokemonType } from "./type-matrix";
import type { DexEntryData, DexMove, EvolutionNode } from "./dex-types";
import { lookalikesOf } from "./lookalikes";
import { fixEvolutionConditions } from "./evolution-fixes";
import { getEncounters } from "./encounters";

/**
 * Assembles everything the study Pokédex shows for one species into a single
 * serializable object. Runs at build time only (pages are fully static).
 */

interface RawAbility {
  name: string;
  hidden: boolean;
  effect: string;
}

interface RawDetails {
  id: number;
  captureRate: number | null;
  baseHappiness: number | null;
  genderRate: number;
  hatchCounter: number | null;
  isBaby: boolean;
  genderDifferences: boolean;
  growthRate: string | null;
  eggGroups: string[];
  baseExp: number | null;
  evYield: Partial<Record<StatKey, number>>;
  abilities: RawAbility[];
  evolution: string[];
  entries: { text: string; games: string[] }[];
  dexNumbers: { dex: string; number: number }[];
  forms: { id: number; slug: string; name: string; types: string[]; stats: Record<StatKey, number>; abilities: RawAbility[] }[];
  learnset: { game: string; moves: [number, string, number, string?][] } | null;
}

interface RawMove {
  name: string;
  type: string;
  cls: string;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
  priority: number;
  gen: number;
  effect: string;
}

const DETAILS = detailsData as unknown as Record<string, RawDetails>;
const MOVES = movesData as unknown as Record<string, RawMove>;
const STAT_KEYS: StatKey[] = ["hp", "atk", "def", "spa", "spd", "spe"];

/** Share of all species with a strictly lower value — "faster than 73% of Pokémon". */
function percentile(value: number, values: number[]): number {
  const below = values.filter((v) => v < value).length;
  return Math.round((below / values.length) * 100);
}

const STAT_DISTRIBUTIONS = Object.fromEntries(
  [...STAT_KEYS, "bst" as const].map((k) => [k, POKEDEX.map((p) => (k === "bst" ? p.bst : p.stats[k]))])
) as Record<StatKey | "bst", number[]>;

function buildEvolutionTree(p: Pokemon): EvolutionNode | null {
  const family = evolutionFamily(p);
  if (family.length < 2) return null;
  const toNode = (s: Pokemon): EvolutionNode => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    types: s.types,
    conditions: fixEvolutionConditions(s.id, DETAILS[s.id]?.evolution ?? []),
    children: family
      .filter((c) => c.evolvesFrom === s.id)
      .sort((a, b) => a.id - b.id)
      .map(toNode),
  });
  // A chain can hold unrelated roots (Phione and Manaphy share one): use the
  // root whose subtree actually contains this species.
  const roots = family.filter((f) => !f.evolvesFrom || !family.some((x) => x.id === f.evolvesFrom));
  const contains = (n: EvolutionNode): boolean => n.id === p.id || n.children.some(contains);
  const tree = roots.map(toNode).find(contains);
  return tree && tree.children.length > 0 ? tree : null;
}

function learnset(raw: RawDetails): DexEntryData["learnset"] {
  if (!raw.learnset) return null;
  const moves: DexMove[] = raw.learnset.moves
    .map(([id, method, level, tm]) => {
      const mv = MOVES[id];
      if (!mv) return null;
      return {
        id,
        method: method as DexMove["method"],
        level,
        tm: tm ?? null,
        name: mv.name,
        type: mv.type,
        cls: mv.cls as DexMove["cls"],
        power: mv.power,
        accuracy: mv.accuracy,
        pp: mv.pp,
        priority: mv.priority,
        effect: mv.effect,
      };
    })
    .filter((m): m is DexMove => m !== null);
  return { game: raw.learnset.game, moves };
}

export function getDexEntry(p: Pokemon): DexEntryData {
  const raw = DETAILS[p.id];
  const profile = defensiveProfile(p.types);
  const ownTypes = p.types as PokemonType[];
  const superEffectiveOn = TYPES.filter((def) => ownTypes.some((atk) => effectiveness(atk, [def]) === 2));
  const neighbour = (id: number) => {
    const n = getPokemon(id);
    return n ? { id: n.id, slug: n.slug, name: n.name } : null;
  };

  return {
    core: p,
    captureRate: raw?.captureRate ?? null,
    baseHappiness: raw?.baseHappiness ?? null,
    genderRate: raw?.genderRate ?? -1,
    hatchCounter: raw?.hatchCounter ?? null,
    isBaby: raw?.isBaby ?? false,
    genderDifferences: raw?.genderDifferences ?? false,
    growthRate: raw?.growthRate ?? null,
    eggGroups: raw?.eggGroups ?? [],
    baseExp: raw?.baseExp ?? null,
    evYield: raw?.evYield ?? {},
    abilities: raw?.abilities ?? p.abilities.map((a) => ({ name: a.name, hidden: a.hidden, effect: "" })),
    entries: raw?.entries ?? p.flavor.map((text) => ({ text, games: [] })),
    dexNumbers: raw?.dexNumbers ?? [],
    forms: raw?.forms ?? [],
    evolutionTree: buildEvolutionTree(p),
    learnset: raw ? learnset(raw) : null,
    defenses: TYPES.map((t) => ({ type: t, multiplier: profile.get(t)! })),
    stabSuperEffective: superEffectiveOn,
    percentiles: Object.fromEntries(
      [...STAT_KEYS, "bst" as const].map((k) => [k, percentile(k === "bst" ? p.bst : p.stats[k], STAT_DISTRIBUTIONS[k])])
    ) as DexEntryData["percentiles"],
    encounters: getEncounters(p.id),
    prev: neighbour(p.id - 1),
    next: neighbour(p.id + 1),
    lookalikes: lookalikesOf(p.id, (o) => !evolutionFamily(p).some((f) => f.id === o.id))
      .slice(0, 6)
      .map(({ pokemon: o, similarity }) => ({ id: o.id, slug: o.slug, name: o.name, types: o.types, similarity })),
  };
}
