import { GENERATION_REGIONS, type Pokemon } from "@/lib/pokemon/pokedex";
import type { QuizLang } from "./i18n";
import { must } from "./localize";

/**
 * Phrases several modules share, in another language (English keeps its own in ./shared.ts). Each throws through
 * `must` when a name is missing, which makes the question unwordable (and swapped).
 */

export const pokemonName = (L: QuizLang, p: Pokemon) => must(L.pokemon(p), `pokemon ${p.id}`);

/** "Pokémon Graine", "Samen-Pokémon", "たねポケモン": the data sometimes leaves the word "Pokémon" out. */
export function genusOf(L: QuizLang, p: Pokemon): string {
  const g = must(L.name("genus", p.genus), `genus ${p.genus}`);
  if (L.locale === "ja") return g.includes("ポケモン") ? g : `${g}ポケモン`;
  if (/Pokémon/.test(g)) return g;
  return L.locale === "de" ? `${g}-Pokémon` : `Pokémon ${g}`;
}

export const regionOf = (L: QuizLang, gen: number) => must(L.name("regions", GENERATION_REGIONS[gen]), `region ${gen}`);

/** The answer explained: "It's Bulbasaur, the Seed Pokémon — Grass / Poison type from Gen 1 (Kanto)." */
export function describeIn(L: QuizLang, p: Pokemon): string {
  const values = { name: pokemonName(L, p), types: L.typing(p.types), gen: p.gen, region: regionOf(L, p.gen) };
  // The newest species' categories aren't in every language's data yet.
  return L.name("genus", p.genus) ? L.t("describe", { ...values, genus: genusOf(L, p) }) : L.t("describeShort", values);
}
