import "server-only";
import type { OtherLocale } from "@/i18n/config";
import type { Translator } from "@/i18n/catalog";
import type dataNs from "@/messages/pokemon-data";
import type sizesNames from "@/messages/sizes-names";
import ids from "@/data/quiz/i18n/pokeapi-ids.json";
import { normalizeName } from "@/components/pokedle/search";
import { buildSizesLocal } from "@/components/sizes/local";
import { speciesName } from "@/lib/names/species";
import { evolutionIn } from "@/lib/pokemon/dex-entry-local";
import { dataKey, dexTable, dexTexts, genusIn, nameIn, typeNames } from "@/lib/pokemon/dex-local";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { SIZE_FORM_ITEMS, SIZE_POKEMON } from "@/lib/sizes/data";
import { labDetails, labRows } from "./data";
import type { LabDetails, LabEvoNode, LabLocal, LabRow } from "./types";

/**
 * The Professor's Lab in another language (server only; English pages call none of it): each Pokémon's official name
 * and category there (forms named by the games' patterns, as /pokedex/sizes names them), the other names its search
 * takes (English, and rōmaji for Japanese), the type names, and each Pokémon's details with the language's Pokédex
 * entry, abilities and evolution methods. Anything the data has no official text for stays out (no entry) or keeps
 * its English wording (an evolution method it can't word), never an invented one.
 */

const ABILITY_IDS = (ids as { abilities: Record<string, string> }).abilities;

/** Art id (species number, or a form's PokéAPI id) → the figure's key in /pokedex/sizes. */
const KEYS = new Map<number, string>([...SIZE_POKEMON.map((s) => [s.species, s.key] as const), ...SIZE_FORM_ITEMS.map((f) => [f.art, f.key] as const)]);

const rowCache = new Map<OtherLocale, LabRow[]>();

/** labRows() with names and categories in the language, each row followed by its English name and its other names (folded, space separated). */
export function labRowsIn(locale: OtherLocale, names: Translator<typeof sizesNames.en>): LabRow[] {
  let rows = rowCache.get(locale);
  if (rows) return rows;
  const { local } = buildSizesLocal(locale, names);
  rows = labRows().map((r) => {
    const key = KEYS.get(r[0]) ?? "";
    const english = r[2];
    const own = local.names[key] ?? english;
    const others = new Set([english, ...(local.alt[key] ?? [])].map(normalizeName).filter((s) => s && s !== normalizeName(own)));
    const out = [...r] as LabRow;
    out[2] = own;
    out[3] = genusIn(locale, r[3]);
    out[23] = english;
    out[24] = [...others].join(" ");
    return out;
  });
  rowCache.set(locale, rows);
  return rows;
}

/** What the lab's client needs besides its rows on a page in this language. */
export function labLocal(locale: OtherLocale): LabLocal {
  return { types: typeNames(locale) };
}

/** labDetails(id) in the language (`data`: its pokemon-data messages, for the evolution methods). */
export function labDetailsIn(id: number, locale: OtherLocale, data: Translator<typeof dataNs.en>): LabDetails | null {
  const en = labDetails(id);
  if (!en) return null;
  const art = labRows().find((r) => r[0] === id);
  const species = art ? art[15] : id;
  const versions = dexTable(locale, "versions");
  // The games' first entry in the language, like the English (the oldest); none after Generation 8.
  const texts = dexTexts(locale, "species")[species] ?? [];
  const first = texts[texts.length - 1];
  const abilityTexts = dexTexts(locale, "abilities");
  const evolution = evolutionIn(locale, data);
  const tree = (n: LabEvoNode): LabEvoNode => ({
    id: n.id,
    name: speciesName(n.id, getPokemon(n.id)?.name ?? n.name, locale),
    conditions: n.conditions.map(evolution),
    children: n.children.map(tree),
  });
  return {
    id,
    entry: first ? { text: first.text.replace(/\s+/g, " ").trim(), games: first.versions.map((v) => versions[dataKey(v)] ?? v) } : null,
    abilities: en.abilities.map((a) => ({
      name: nameIn(locale, "abilities", a.name),
      hidden: a.hidden,
      effect: abilityTexts[ABILITY_IDS[dataKey(a.name)] ?? ""]?.[0]?.text.replace(/\s+/g, " ").trim() ?? "",
    })),
    evolution: en.evolution && tree(en.evolution),
  };
}
