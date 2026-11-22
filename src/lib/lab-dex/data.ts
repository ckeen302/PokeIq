import "server-only";
import { Dex } from "@pkmn/dex";
import detailsData from "@/data/pokedex-details.json";
import { POKEDEX, evolutionFamily, getPokemon, type Pokemon } from "@/lib/pokemon/pokedex";
import { fixEvolutionConditions } from "@/lib/pokemon/evolution-fixes";
import { SIZE_FORM_ITEMS, SIZE_FORMS, SIZE_POKEMON } from "@/lib/sizes/data";
import type { FormKind, LabDetails, LabEvoNode, LabRow } from "./types";

/**
 * Build-time data for the Professor's Lab: the wheel's compact index (every
 * species and every form /pokedex/sizes has a 3D figure for) and each
 * Pokémon's details, served as static JSON by /api/lab-dex/<id>.
 */

interface RawAbility {
  name: string;
  hidden: boolean;
  effect: string;
}
interface RawDetails {
  abilities: RawAbility[];
  evolution: string[];
  entries: { text: string; games: string[] }[];
  forms?: { id: number; abilities: RawAbility[] }[];
}
const DETAILS = detailsData as unknown as Record<string, RawDetails>;

const FORM_ROWS = new Map(SIZE_FORMS.map((f) => [f.id, f]));

function flags(p: Pokemon, form: boolean): number {
  return (p.legendary ? 1 : 0) | (p.mythical ? 2 : 0) | (p.fullyEvolved ? 4 : 0) | (form ? 8 : 0);
}

/** Every Pokémon on the wheel: species in number order, then the forms (the client puts each after its species). */
export function labRows(): LabRow[] {
  const species: LabRow[] = SIZE_POKEMON.map((s) => {
    const p = getPokemon(s.species)!;
    const st = p.stats;
    return [p.id, p.slug, p.name, p.genus, p.types.join(" "), p.gen, st.hp, st.atk, st.def, st.spa, st.spd, st.spe, p.height, p.weight, flags(p, false), p.id, p.chain, p.evolvesFrom ?? 0, "", s.bx, s.by, s.bw, s.bh];
  });
  const forms: LabRow[] = SIZE_FORM_ITEMS.filter((f) => f.stats).map((f) => {
    const p = getPokemon(f.species)!;
    const row = FORM_ROWS.get(f.art)!;
    const st = f.stats!;
    return [f.art, p.slug, f.name, p.genus, f.types.join(" "), p.gen, st[0], st[1], st[2], st[3], st[4], st[5], row.height, f.kg == null ? -1 : row.weight, flags(p, true), p.id, p.chain, 0, f.kind as FormKind, f.bx, f.by, f.bw, f.bh];
  });
  return [...species, ...forms];
}

/** Every id /api/lab-dex/<id> answers for. */
export function labIds(): number[] {
  return labRows().map((r) => r[0]);
}

function evolutionTree(p: Pokemon): LabEvoNode | null {
  const family = evolutionFamily(p);
  if (family.length < 2) return null;
  const toNode = (s: Pokemon): LabEvoNode => ({
    id: s.id,
    name: s.name,
    conditions: fixEvolutionConditions(s.id, DETAILS[s.id]?.evolution ?? []),
    children: family
      .filter((c) => c.evolvesFrom === s.id)
      .sort((a, b) => a.id - b.id)
      .map(toNode),
  });
  // A chain can hold unrelated roots (Phione and Manaphy share one): the root whose line holds this species.
  const roots = family.filter((f) => !f.evolvesFrom || !family.some((x) => x.id === f.evolvesFrom));
  const contains = (n: LabEvoNode): boolean => n.id === p.id || n.children.some(contains);
  const tree = roots.map(toNode).find(contains);
  return tree && tree.children.length > 0 ? tree : null;
}

/** A form's abilities: the Pokédex data's own entry for the form, else Pokémon Showdown's data for that forme. */
function formAbilities(slug: string, formId: number, speciesId: number): RawAbility[] {
  const own = DETAILS[speciesId]?.forms?.find((f) => f.id === formId)?.abilities;
  if (own?.length) return own;
  const s = Dex.species.get(slug);
  if (!s.exists || s.num !== speciesId) return [];
  const slots = Object.entries(s.abilities) as [string, string][];
  return slots.map(([slot, name]) => ({ name, hidden: slot === "H", effect: Dex.abilities.get(name).shortDesc || "" }));
}

export function labDetails(id: number): LabDetails | null {
  const species = POKEDEX.find((p) => p.id === id);
  const form = species ? null : SIZE_FORM_ITEMS.find((f) => f.art === id);
  const p = species ?? (form ? getPokemon(form.species) : undefined);
  if (!p) return null;
  const raw = DETAILS[p.id];
  const entry = raw?.entries?.[0] ?? null;
  const abilities = form ? formAbilities(form.key, form.art, p.id) : (raw?.abilities ?? []);
  return {
    id,
    entry: entry ? { text: entry.text.replace(/\s+/g, " ").trim(), games: entry.games } : null,
    abilities: abilities.map((a) => ({ name: a.name, hidden: a.hidden, effect: a.effect })),
    evolution: evolutionTree(p),
  };
}
