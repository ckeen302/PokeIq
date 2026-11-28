/**
 * A source's form label ("Alolan Form", "Midnight Form", "Pa'u Style", "Galarian form") -> the PokéAPI pokemon of
 * that species (its name and id, for the art), by the species' varieties (https://pokeapi.co/api/v2/pokemon-species/).
 * The species' default variety is "no form".
 */
import { getJson } from "./fetch";
import { idOf } from "./pokeapi";

type Species = { is_legendary?: boolean; is_mythical?: boolean; varieties: { is_default: boolean; pokemon: { name: string; url: string } }[] };

const memo = new Map<number, Species | null>();
async function species(id: number): Promise<Species | null> {
  if (!memo.has(id)) memo.set(id, await getJson<Species>(`pokeapi/pokemon-species/${id}`, `https://pokeapi.co/api/v2/pokemon-species/${id}/`));
  return memo.get(id)!;
}

const REGIONAL: Record<string, string> = { alolan: "alola", galarian: "galar", hisuian: "hisui", paldean: "paldea", kantonian: "", johtonian: "", hoennian: "", sinnohan: "", unovan: "", kalosian: "" };

/** The label's token as PokéAPI spells form suffixes ("Pa'u Style" -> "pau", "Alolan Form" -> "alola"). */
function token(label: string): string {
  let t = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/\b(form|forme|style|mode|pattern|cloak|flower|plumage|sea|size|striped form)\b/g, (w) => (w === "striped form" ? "striped" : ""))
    .trim()
    .replace(/\s+/g, "-");
  const first = t.split("-")[0];
  if (first in REGIONAL) t = REGIONAL[first];
  return t;
}

export interface FormHit {
  form?: string;
  art?: number;
}

/**
 * The PokéAPI form a label names for a species: `{}` for the default variety (or a regional label meaning the original
 * form, e.g. "Kantonian Form"), `{ form, art }` for another variety, null when no variety matches (the label names a
 * cosmetic form PokéAPI doesn't list as a pokemon, e.g. Shellos's East Sea).
 */
export async function formFor(speciesId: number, label: string | undefined): Promise<FormHit | null> {
  if (!label) return {};
  const t = token(label);
  if (!t) return {};
  const sp = await species(speciesId);
  if (!sp) return null;
  const hit = sp.varieties.find((v) => v.pokemon.name.endsWith(`-${t}`) || v.pokemon.name.includes(`-${t}-`));
  if (!hit) return null;
  if (hit.is_default) return {};
  return { form: hit.pokemon.name, art: idOf(hit.pokemon.url) };
}

/** PokéAPI's Legendary or Mythical flag for a species. */
export async function isLegendary(speciesId: number): Promise<boolean> {
  const sp = await species(speciesId);
  return !!(sp?.is_legendary || sp?.is_mythical);
}
