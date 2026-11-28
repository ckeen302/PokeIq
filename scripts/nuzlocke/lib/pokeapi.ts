/**
 * PokéAPI's location data: every location, its areas and each area's encounters per version
 * (https://pokeapi.co/docs/v2#locations-section). Cached through ./fetch.
 */
import { getJson, pool } from "./fetch";

const API = "https://pokeapi.co/api/v2";
type Named = { name: string; url: string };
type LangName = { name: string; language: { name: string } };

export interface ApiEncounterDetail {
  min_level: number;
  max_level: number;
  chance: number;
  method: Named;
  condition_values: Named[];
}
export interface ApiLocationArea {
  id: number;
  name: string;
  names: LangName[];
  location: Named;
  pokemon_encounters: { pokemon: Named; version_details: { version: Named; max_chance: number; encounter_details: ApiEncounterDetail[] }[] }[];
}
export interface ApiLocation {
  id: number;
  name: string;
  names: LangName[];
  region: Named | null;
  areas: Named[];
}

export const idOf = (url: string) => Number(url.match(/\/(\d+)\/?$/)![1]);
export const enName = (names: LangName[] | undefined) => names?.find((n) => n.language.name === "en")?.name;

/** Every location-area and location PokéAPI has. */
export async function loadAll(): Promise<{ areas: ApiLocationArea[]; locations: Map<number, ApiLocation> }> {
  const list = await getJson<{ results: Named[] }>("pokeapi/location-area-list", `${API}/location-area?limit=5000`);
  const areas = (await pool(list!.results, 8, (r) => getJson<ApiLocationArea>(`pokeapi/location-area/${idOf(r.url)}`, r.url))).filter((a): a is ApiLocationArea => !!a);
  const locList = await getJson<{ results: Named[] }>("pokeapi/location-list", `${API}/location?limit=5000`);
  const locs = (await pool(locList!.results, 8, (r) => getJson<ApiLocation>(`pokeapi/location/${idOf(r.url)}`, r.url))).filter((l): l is ApiLocation => !!l);
  return { areas, locations: new Map(locs.map((l) => [l.id, l])) };
}

export interface ApiPokemon {
  id: number;
  name: string;
  species: Named;
  is_default: boolean;
}

/** A PokéAPI pokemon (form) by name or id: its national dex species and whether it's the default form. */
export async function pokemon(nameOrId: string | number): Promise<ApiPokemon | null> {
  const p = await getJson<ApiPokemon & { [k: string]: unknown }>(`pokeapi/pokemon/${nameOrId}`, `${API}/pokemon/${nameOrId}/`);
  return p ? { id: p.id, name: p.name, species: p.species, is_default: p.is_default } : null;
}
