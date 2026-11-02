import "server-only";
import ART from "@/data/sizes-art.json";
import RACE_FORMS from "@/data/race-forms.json";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { isLength } from "@/lib/sizes/types";
import { motionFor } from "./gait";
import type { Entrant, RaceKind } from "./types";

/**
 * Build-time list of every runner /pokedex/race can field: the 1,025
 * Pokémon (stats, height, weight, shape, types and abilities from
 * src/data/pokedex.json) and every alternate form with its own base stats
 * (src/data/race-forms.json, from PokéAPI: scripts/race-data.ts). Render
 * boxes come from the Sizes data (src/data/sizes-art.json) or, for forms
 * Sizes doesn't show, from race-forms.json; their relief maps from
 * public/sizes/depth or public/race/depth.
 */

type Box = [number, number, number, number, number];
const SIZES_BOX = ART as unknown as Record<string, Box>;

interface FormRow { id: number; species: number; slug: string; name: string; kind: string; height: number; weight: number; types: string[]; stats: number[]; abilities: string[]; box?: number[] }
export const RACE_FORM_ROWS = (RACE_FORMS as { forms: FormRow[] }).forms;

const SPECIES = new Map(POKEDEX.map((p) => [p.id, p]));

const POKEMON: Entrant[] = POKEDEX.map((p) => {
  const box = SIZES_BOX[String(p.id)];
  if (!box) throw new Error(`race: no HOME render box for ${p.id}`);
  return {
    key: p.slug,
    name: p.name,
    kind: "pokemon",
    species: p.id,
    art: p.id,
    stats: { ...p.stats },
    m: p.height / 10,
    length: isLength(p.shape, box[2], box[3]),
    kg: p.weight / 10,
    shape: p.shape,
    types: [...p.types],
    motion: motionFor({ shape: p.shape, types: p.types, abilities: p.abilities.map((a) => a.name), species: p.id }),
    gen: p.gen,
    legendary: p.legendary,
    mythical: p.mythical,
    chain: p.chain,
    evolved: p.fullyEvolved,
    box: [...box] as Box,
    depth: "sizes",
  };
});

const FORMS: Entrant[] = RACE_FORM_ROWS.map((f) => {
  const p = SPECIES.get(f.species);
  if (!p) throw new Error(`race: form ${f.slug} has no species ${f.species}`);
  const sizesBox = SIZES_BOX[String(f.id)];
  const box = (sizesBox ?? f.box) as Box | undefined;
  if (!box) throw new Error(`race: no HOME render box for ${f.slug}`);
  const [hp, atk, def, spa, spd, spe] = f.stats;
  return {
    key: f.slug,
    name: f.name,
    kind: f.kind as RaceKind,
    species: p.id,
    art: f.id,
    stats: { hp, atk, def, spa, spd, spe },
    m: f.height / 10,
    length: isLength(p.shape, box[2], box[3]),
    kg: f.weight / 10,
    shape: p.shape,
    types: [...f.types],
    motion: motionFor({ shape: p.shape, types: f.types, abilities: f.abilities, species: p.id }),
    gen: p.gen,
    legendary: p.legendary,
    mythical: p.mythical,
    chain: p.chain,
    evolved: p.fullyEvolved,
    box: [...box] as Box,
    depth: sizesBox ? "sizes" : "race",
  };
});

/** Every runner: the 1,025 Pokémon, then the forms with their own stats. */
export const RACE_ENTRANTS: Entrant[] = [...POKEMON, ...FORMS];
export const RACE_BY_KEY = new Map(RACE_ENTRANTS.map((e) => [e.key, e]));
export const RACE_POKEMON = POKEMON;
