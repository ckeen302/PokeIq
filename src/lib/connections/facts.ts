import pokedexData from "@/data/pokedex.json";
import detailsData from "@/data/pokedex-details.json";
import movesData from "@/data/moves.json";
import poolData from "@/data/pokedle-pool.json";
import { fixEvolutionConditions } from "@/lib/pokemon/evolution-fixes";
import type { StatKey } from "@/lib/pokemon/constants";

/**
 * PokéConnections' facts about every Pokémon, read from the committed
 * Pokédex snapshot (src/data/pokedex.json and pokedex-details.json, built by
 * scripts/ingest-*.ts from PokéAPI) and nothing else: every category in
 * ./categories is a test over these fields, so a puzzle is only ever as
 * right as the data.
 *
 * Base forms only: a species' types, stats and abilities are its default
 * form's. Its other forms (regional, Mega, Gigantamax) are listed in
 * `regionalForms`, `mega` and `gmax` for the categories that are about them.
 *
 * Not imported by any client code (the snapshot is megabytes and the
 * categories are the answers).
 */

export type Region = "alola" | "galar" | "hisui" | "paldea";

export interface Facts {
  id: number;
  name: string;
  gen: number;
  types: string[];
  stats: Record<StatKey, number>;
  bst: number;
  /** Decimetres. */
  height: number;
  /** Hectograms. */
  weight: number;
  color: string;
  legendary: boolean;
  mythical: boolean;
  baby: boolean;
  /** Its evolution family (same chain), itself included. */
  family: number[];
  /** The family's lowest Pokédex number: one key per evolution family. */
  familyKey: number;
  evolvesFrom: number | null;
  /** How it evolves from `evolvesFrom` (empty for a base form), PokéAPI's wording with the repo's fixes. */
  evolution: string[];
  /** Pretty names ("Levitate"), with the hidden flag. */
  abilities: { name: string; hidden: boolean }[];
  eggGroups: string[];
  /** −1 genderless, else eighths female (0 always male, 8 always female). */
  genderRate: number;
  /** The regional forms it has (a form of this species, e.g. Vulpix -> Alolan Vulpix). */
  regionalForms: Region[];
  mega: boolean;
  gmax: boolean;
  /** The game its learnset is from ("Scarlet & Violet" for every Pokémon in SV), or null. */
  learnsetGame: string | null;
  /** Level-up moves in that game: move id -> lowest level (0 = learnt on evolution). */
  levelUp: Map<number, number>;
  /** Every move it can learn in that game, by any method. */
  learnable: Set<number>;
  /** In Pokédle's recognisable-Pokémon pool (the dailies draw tiles from it). */
  pooled: boolean;
}

interface RawPokemon {
  id: number;
  name: string;
  gen: number;
  types: string[];
  stats: Record<StatKey, number>;
  bst: number;
  height: number;
  weight: number;
  color: string;
  chain: number;
  evolvesFrom: number | null;
  legendary: boolean;
  mythical: boolean;
}

interface RawDetails {
  isBaby: boolean;
  genderRate: number;
  eggGroups: string[];
  abilities: { name: string; hidden: boolean }[];
  evolution: string[];
  forms: { slug: string; name: string }[];
  learnset: { game: string; moves: [number, string, number, string?][] } | null;
}

export interface RawMove {
  name: string;
  type: string;
  gen: number;
}

const POKEDEX = pokedexData as unknown as RawPokemon[];
const DETAILS = detailsData as unknown as Record<string, RawDetails>;
export const MOVES = movesData as unknown as Record<string, RawMove>;
const POOL = new Set((poolData as { tiers: number[][] }).tiers.flat());

export const SV = "Scarlet & Violet";

const REGIONS: Region[] = ["alola", "galar", "hisui", "paldea"];

/**
 * Evolution methods the data files under a species that only its regional
 * form uses. Tiles are base forms, so these don't count: Sandslash evolves
 * at level 22; it's Alolan Sandslash that takes an Ice Stone.
 */
const REGIONAL_METHODS: Record<number, string[]> = {
  20: ["Level 20 at night"], // Alolan Raticate
  28: ["Use Ice Stone"], // Alolan Sandslash
  38: ["Use Ice Stone"], // Alolan Ninetales
  53: ["Level up with high friendship"], // Alolan Persian
  80: ["Use Galarica Cuff"], // Galarian Slowbro
  105: ["Level 28 at night"], // Alolan Marowak
  199: ["Use Galarica Wreath"], // Galarian Slowking
  555: ["Use Ice Stone"], // Galarian Darmanitan
};

function build(): Facts[] {
  const chains = new Map<number, number[]>();
  for (const p of POKEDEX) chains.set(p.chain, [...(chains.get(p.chain) ?? []), p.id]);
  return POKEDEX.map((p) => {
    const d = DETAILS[String(p.id)];
    const levelUp = new Map<number, number>();
    const learnable = new Set<number>();
    for (const [move, method, level] of d.learnset?.moves ?? []) {
      learnable.add(move);
      if (method === "L") levelUp.set(move, Math.min(level, levelUp.get(move) ?? Infinity));
    }
    // A form's slug names its region ("vulpix-alola", "tauros-paldea-combat-breed"); totem forms aren't regional forms.
    const formSlugs = d.forms.map((f) => f.slug).filter((s) => !s.includes("totem"));
    return {
      id: p.id,
      name: p.name,
      gen: p.gen,
      types: p.types,
      stats: p.stats,
      bst: p.bst,
      height: p.height,
      weight: p.weight,
      color: p.color,
      legendary: p.legendary,
      mythical: p.mythical,
      baby: d.isBaby,
      family: chains.get(p.chain) ?? [p.id],
      familyKey: Math.min(...(chains.get(p.chain) ?? [p.id])),
      evolvesFrom: p.evolvesFrom,
      evolution: p.evolvesFrom ? fixEvolutionConditions(p.id, d.evolution).filter((c) => !REGIONAL_METHODS[p.id]?.includes(c)) : [],
      abilities: d.abilities.map((a) => ({ name: a.name, hidden: a.hidden })),
      eggGroups: d.eggGroups,
      genderRate: d.genderRate,
      regionalForms: REGIONS.filter((r) => formSlugs.some((s) => s.split("-").includes(r))),
      mega: formSlugs.some((s) => /-mega(-[xy])?$/.test(s)),
      gmax: formSlugs.some((s) => s.endsWith("-gmax")),
      learnsetGame: d.learnset?.game ?? null,
      levelUp,
      learnable,
      pooled: POOL.has(p.id),
    };
  });
}

export const FACTS: Facts[] = build();
const BY_ID = new Map(FACTS.map((f) => [f.id, f]));

export function factsOf(id: number): Facts {
  const f = BY_ID.get(id);
  if (!f) throw new Error(`No Pokémon #${id}`);
  return f;
}

export const nameOf = (id: number) => factsOf(id).name;

/** "Thunder Stone" from "Use Thunder Stone" / "Use Dawn Stone (male)"; null when no stone is used. */
export function stoneOf(condition: string): string | null {
  const m = /^Use ([A-Z][a-z]+ Stone)\b/.exec(condition);
  return m ? m[1] : null;
}

export const isTrade = (condition: string) => /^Trade\b/.test(condition);
export const isFriendship = (condition: string) => /high friendship/.test(condition);
