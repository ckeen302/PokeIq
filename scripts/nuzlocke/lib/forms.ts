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
  // Let's Go's partner Pikachu and Eevee are PokéAPI's "-starter" varieties ("Partner Cap" is another Pikachu).
  if (t === "partner") t = "starter";
  return t;
}

export interface FormHit {
  form?: string;
  art?: number;
}

/**
 * Cosmetic forms that depend on where the Pokémon is met (East Sea Shellos east of Mt. Coronet, Flabébé's flower
 * colours by route): PokéAPI has no pokemon for them, only a pokemon-form of the species' default pokemon
 * (https://pokeapi.co/api/v2/pokemon/422/ lists shellos-west, shellos-east). Such a form is written with its
 * pokemon-form name and no art id (no art of its own exists; the species' art stands in).
 */
const COSMETIC_SPECIES = new Set([422, 423, 669, 670, 671]);
export const COSMETIC_FORMS = new Set([
  "shellos-east",
  "gastrodon-east",
  ...["flabebe", "floette", "florges"].flatMap((p) => ["yellow", "orange", "blue", "white"].map((c) => `${p}-${c}`)),
]);
type ApiPokemon = { forms: { name: string; url: string }[] };
const pokemonMemo = new Map<number, ApiPokemon | null>();
async function cosmeticFor(speciesId: number, t: string): Promise<FormHit | null> {
  if (!COSMETIC_SPECIES.has(speciesId)) return null;
  if (!pokemonMemo.has(speciesId)) pokemonMemo.set(speciesId, await getJson<ApiPokemon>(`pokeapi/pokemon/${speciesId}`, `https://pokeapi.co/api/v2/pokemon/${speciesId}/`));
  const forms = pokemonMemo.get(speciesId)?.forms ?? [];
  const i = forms.findIndex((f) => f.name.endsWith(`-${t}`));
  if (i < 0) return null;
  // The pokemon's first form is its default one (shellos-west, flabebe-red): no form.
  if (i === 0) return {};
  if (!COSMETIC_FORMS.has(forms[i].name)) throw new Error(`cosmetic form ${forms[i].name} is not in COSMETIC_FORMS`);
  return { form: forms[i].name };
}

/**
 * The PokéAPI form a label names for a species: `{}` for the default variety (or a regional label meaning the original
 * form, e.g. "Kantonian Form"), `{ form, art }` for another variety, `{ form }` for a location-dependent cosmetic form
 * (Shellos's East Sea: "shellos-east"), null when nothing matches (another cosmetic label, e.g. a season).
 */
export async function formFor(speciesId: number, label: string | undefined): Promise<FormHit | null> {
  if (!label) return {};
  const t = token(label);
  if (!t) return {};
  const sp = await species(speciesId);
  if (!sp) return null;
  const hit = sp.varieties.find((v) => v.pokemon.name.endsWith(`-${t}`) || v.pokemon.name.includes(`-${t}-`));
  if (!hit) return cosmeticFor(speciesId, t);
  if (hit.is_default) return {};
  return { form: hit.pokemon.name, art: idOf(hit.pokemon.url) };
}

/** PokéAPI's Legendary or Mythical flag for a species. */
export async function isLegendary(speciesId: number): Promise<boolean> {
  const sp = await species(speciesId);
  return !!(sp?.is_legendary || sp?.is_mythical);
}
