import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { OtherLocale } from "@/i18n/config";
import { INTL_LOCALE } from "@/i18n/catalog";
import { normalizeName } from "@/components/pokedle/search";
import { speciesAliases } from "@/lib/names/species";
import type { DexListLocal } from "./dex-search-local";
import { POKEDEX } from "./pokedex";
import { TYPES, capitalize } from "./type-matrix";

/**
 * The Pokédex's official names and texts in another language, for its server components (src/data/i18n/<locale>,
 * from PokéAPI): read from disk once per language and file, only when a page in that language renders, so English
 * pages never load any of it. A name the data lacks stays English (never an invented one).
 */

export type Table = Record<string, string>;
export interface GameText {
  text: string;
  /** PokéAPI version (group) slugs, e.g. "sword", "lets-go-pikachu-lets-go-eevee". */
  versions: string[];
}

export type TableKind =
  | "abilities"
  | "colors"
  | "damage-classes"
  | "egg-groups"
  | "generations"
  | "genus"
  | "habitats"
  | "items"
  | "locations"
  | "moves"
  | "natures"
  | "regions"
  | "stats"
  | "types"
  | "versions";
export type TextKind = "species" | "moves" | "abilities" | "items";

/** How src/data/i18n keys a name: its English, without accents, lowercase letters and digits only. */
export const dataKey = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const cache = new Map<string, unknown>();
function read<T>(locale: OtherLocale, file: string): T {
  const key = `${locale}/${file}`;
  let v = cache.get(key) as T | undefined;
  if (v === undefined) {
    try {
      v = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/data/i18n", locale, `${file}.json`), "utf8")) as T;
    } catch {
      v = {} as T;
    }
    cache.set(key, v);
  }
  return v;
}

/** A language's table of official names, keyed by dataKey(English). */
export const dexTable = (locale: OtherLocale, kind: TableKind): Table => read<Table>(locale, kind);

/** A language's game texts (Pokédex entries, descriptions), by PokéAPI id, newest first. */
export const dexTexts = (locale: OtherLocale, kind: TextKind): Record<string, GameText[]> => read<Record<string, GameText[]>>(locale, `texts/${kind}`);

/** A name's official translation, or the English name when the data has none. */
export function nameIn(locale: OtherLocale, kind: TableKind, english: string): string {
  return dexTable(locale, kind)[dataKey(english)] ?? english;
}

/** Every type's official name, by type id. */
export function typeNames(locale: OtherLocale): Record<string, string> {
  const table = dexTable(locale, "types");
  return Object.fromEntries(TYPES.map((t) => [t, table[t] ?? capitalize(t)]));
}

/** The regions of Generations 1–9, in order, in the language. */
export const REGION_KEYS = ["kanto", "johto", "hoenn", "sinnoh", "unova", "kalos", "alola", "galar", "paldea"] as const;
export function regionNames(locale: OtherLocale): string[] {
  const table = dexTable(locale, "regions");
  return REGION_KEYS.map((k) => table[k] ?? capitalize(k));
}

/** "A, B and C" as the language lists things. */
export function listIn(locale: OtherLocale, items: readonly string[]): string {
  return new Intl.ListFormat(INTL_LOCALE[locale], { type: "conjunction" }).format(items);
}

/** "A or B" as the language writes it. */
export function orIn(locale: OtherLocale, items: readonly string[]): string {
  return new Intl.ListFormat(INTL_LOCALE[locale], { type: "disjunction" }).format(items);
}

/** A species' category ("Seed Pokémon") in the language. */
export function genusIn(locale: OtherLocale, english: string): string {
  return nameIn(locale, "genus", english);
}

/**
 * What the Pokédex list sends besides its rows on a page in this language: type and region names, and each Pokémon's
 * other names for its search (English name and category; Japanese also rōmaji), folded as the search folds them.
 */
export function dexListLocal(locale: OtherLocale): DexListLocal {
  const search: Record<number, string> = {};
  for (const p of POKEDEX) {
    const others = new Set([...speciesAliases(p.id, p.name, locale), p.name, p.genus].map(normalizeName).filter(Boolean));
    search[p.id] = [...others].join(" ");
  }
  return { types: typeNames(locale), regions: regionNames(locale), search };
}
