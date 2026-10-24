import forms from "@/data/about-forms.json";
import { EEVEELUTIONS, GAME_SLOTS, POKEMON_SLOTS, STARTER_BASES, type AboutData, type AboutPick, type PokemonRule } from "./about-data";
import { POKEDEX, getPokemon } from "./pokemon/pokedex";

/** [form id, species id, slug, name, kind]: alternate forms from the Pokédex snapshot. */
type FormRow = [number, number, string, string, "mega" | "gmax" | "regional" | "other"];
export const FORMS = forms as FormRow[];
const FORM_BY_ID = new Map(FORMS.map((f) => [f[0], f]));

const STARTER_CHAINS = new Set(STARTER_BASES.map((id) => getPokemon(id)?.chain).filter((c): c is number => c !== undefined));
const EEVEE = new Set<number>(EEVEELUTIONS);

/** Does this species/form id satisfy the slot's restriction? */
export function allowedFor(rule: PokemonRule, id: number): boolean {
  const form = FORM_BY_ID.get(id);
  const species = form ? getPokemon(form[1]) : getPokemon(id);
  if (!species) return false;
  switch (rule) {
    case "any":
      return true;
    case "starter":
      return STARTER_CHAINS.has(species.chain);
    case "eeveelution":
      return EEVEE.has(species.id) && !form;
    case "mega":
      return form?.[4] === "mega";
    case "gmax":
      return form?.[4] === "gmax";
    case "regional":
      return form?.[4] === "regional";
  }
}

/** Display name of a species or form, or null if unknown. */
export function pokemonName(id: number): string | null {
  const form = FORM_BY_ID.get(id);
  return form ? form[3] : (getPokemon(id)?.name ?? null);
}

/** Every id the picker can offer a slot (species and forms). */
export function optionsFor(rule: PokemonRule): number[] {
  return [...POKEDEX.map((p) => p.id), ...FORMS.map((f) => f[0])].filter((id) => allowedFor(rule, id));
}

export type Checked = { ok: true; about: AboutData } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Checks a whole "about me" and returns the cleaned data. Unknown slots,
 * unknown Pokémon, picks that break a slot's rule and game choices outside
 * the fixed lists are rejected. Empty slots (null) are dropped.
 */
export function checkAbout(raw: unknown): Checked {
  if (!isObj(raw)) return { ok: false, error: "Nothing to save." };
  const pokemonIn = raw.pokemon ?? {};
  const gamesIn = raw.games ?? {};
  if (!isObj(pokemonIn) || !isObj(gamesIn)) return { ok: false, error: "Nothing to save." };
  const pokemon: Record<string, AboutPick> = {};
  for (const [slotId, v] of Object.entries(pokemonIn)) {
    const slot = POKEMON_SLOTS.find((s) => s.id === slotId);
    if (!slot) return { ok: false, error: `Unknown slot: ${slotId.slice(0, 30)}.` };
    if (v === null || v === undefined) continue;
    if (!isObj(v) || !Number.isInteger(v.id) || (v.shiny !== undefined && typeof v.shiny !== "boolean")) return { ok: false, error: `${slot.label}: that isn't a Pokémon.` };
    const id = v.id as number;
    if (!pokemonName(id)) return { ok: false, error: `${slot.label}: that isn't a Pokémon.` };
    if (!allowedFor(slot.rule, id)) return { ok: false, error: `${slot.label}: that Pokémon doesn't fit this slot.` };
    pokemon[slotId] = { id, shiny: slot.shinyForced ? true : v.shiny === true };
  }
  const games: Record<string, string> = {};
  for (const [slotId, v] of Object.entries(gamesIn)) {
    const slot = GAME_SLOTS.find((s) => s.id === slotId);
    if (!slot) return { ok: false, error: `Unknown slot: ${slotId.slice(0, 30)}.` };
    if (v === null || v === undefined) continue;
    if (typeof v !== "string" || !slot.choices.some((c) => c.id === v)) return { ok: false, error: `${slot.label}: pick one from the list.` };
    games[slotId] = v;
  }
  return { ok: true, about: { pokemon, games } };
}

/** Reads stored data back, keeping each slot that still validates. Never throws. */
export function readAbout(stored: unknown): AboutData {
  const out = checkAbout(stored);
  if (out.ok) return out.about;
  const pokemon: Record<string, AboutPick> = {};
  const games: Record<string, string> = {};
  if (!isObj(stored)) return { pokemon, games };
  for (const [k, v] of Object.entries(isObj(stored.pokemon) ? stored.pokemon : {})) {
    const one = checkAbout({ pokemon: { [k]: v } });
    if (one.ok) Object.assign(pokemon, one.about.pokemon);
  }
  for (const [k, v] of Object.entries(isObj(stored.games) ? stored.games : {})) {
    const one = checkAbout({ games: { [k]: v } });
    if (one.ok) Object.assign(games, one.about.games);
  }
  return { pokemon, games };
}
