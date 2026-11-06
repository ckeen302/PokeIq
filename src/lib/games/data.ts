import "server-only";
import DETAILS from "@/data/pokedex-details.json";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { RACE_ENTRANTS, RACE_FORM_ROWS } from "@/lib/race/data";
import { toRow } from "@/lib/race/types";
import { TRAIT, toAthlete, type Athlete, type AthleteRow } from "./athlete";

/**
 * Build-time list of every athlete the Games can field: the Race's
 * entrants (the 1,025 Pokémon and every form with its own stats, from
 * src/data/pokedex.json and src/data/race-forms.json) with the egg groups
 * of their species (src/data/pokedex-details.json) and their abilities
 * (the species' or the form's own). Served to the 3D page as compact rows
 * by /api/games.
 */

type Detail = { eggGroups?: string[] };
const EGGS = new Map(Object.entries(DETAILS as unknown as Record<string, Detail>).map(([id, d]) => [Number(id), d.eggGroups ?? []]));
const SPECIES_ABILITIES = new Map(POKEDEX.map((p) => [p.slug, p.abilities.map((a) => a.name)]));
const FORM_ABILITIES = new Map(RACE_FORM_ROWS.map((f) => [f.slug, f.abilities]));

export function traitsFor(species: number, abilities: string[]): number {
  const eggs = EGGS.get(species) ?? [];
  let t = 0;
  if (eggs.some((g) => /^Water[123]$/.test(g))) t |= TRAIT.waterEgg;
  if (eggs.includes("Water2")) t |= TRAIT.finEgg;
  if (eggs.includes("Flying")) t |= TRAIT.flyingEgg;
  if (abilities.includes("swift-swim")) t |= TRAIT.swiftSwim;
  if (abilities.includes("levitate")) t |= TRAIT.levitate;
  return t;
}

export const GAMES_ATHLETES: Athlete[] = RACE_ENTRANTS.map((e) => toAthlete(e, traitsFor(e.species, FORM_ABILITIES.get(e.key) ?? SPECIES_ABILITIES.get(e.key) ?? [])));
export const GAMES_BY_KEY = new Map(GAMES_ATHLETES.map((a) => [a.key, a]));
/** The 1,025 Pokémon (default forms only). */
export const GAMES_SPECIES = GAMES_ATHLETES.filter((a) => a.entrant.kind === "pokemon");

export const athleteRows = (): AthleteRow[] => GAMES_ATHLETES.map((a) => [toRow(a.entrant), a.traits]);
