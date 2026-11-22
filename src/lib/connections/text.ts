import compile from "icu-minify/compile";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { defineNamespace, translator, type Translator, type Tree } from "@/i18n/catalog";
import { INTL_LOCALE } from "@/i18n/format";
import type { StatKey } from "@/lib/pokemon/constants";
import { GENERATION_REGIONS, STAT_LABELS } from "@/lib/pokemon/constants";
import groups from "@/messages/connections-groups";
import ja from "@/messages/ja/connections-groups.json";
import es from "@/messages/es/connections-groups.json";
import fr from "@/messages/fr/connections-groups.json";
import de from "@/messages/de/connections-groups.json";
import it from "@/messages/it/connections-groups.json";
import { LOCAL_NAMES } from "./text-data";

/**
 * The words PokéConnections' categories are written with (./categories, ./wordplay, ./curated, ./mixed), in one
 * language: the "connections-groups" messages, and the official names of types, Abilities, moves, items, Egg Groups,
 * colours, stats, regions, games and Pokémon in that language (src/data/i18n, src/data/species-names.json). The
 * categories are built once per language from a kit, so every language shares the same tests and the same lures,
 * only the words differ. English reads exactly as it always did.
 *
 * Server-side only, like the categories themselves.
 */

export type GroupsT = Translator<typeof groups.en>;

export interface Kit {
  locale: Locale;
  t: GroupsT;
  /** English: "an Ice Stone", "a Steel" (other languages: the word alone). */
  a(word: string): string;
  /** A type's name from its id ("fire" → "Fire" / "Feu"). */
  type(id: string): string;
  /** A Pokémon's name from its English name. */
  pokemon(english: string, id: number): string;
  ability(english: string): string;
  move(english: string): string;
  item(english: string): string;
  /** An Egg Group from its English name ("Human-Like"). */
  egg(english: string): string;
  /** A Pokédex colour from its id ("red"): as written in a sentence ("red" / "rouge"). */
  colour(id: string): string;
  /** The same, as a heading ("Red" / "Rouge"). */
  Colour(id: string): string;
  stat(key: StatKey): string;
  /** A generation's region ("Unova" / "Einall"). */
  genRegion(gen: number): string;
  /** A regional form's region ("alola"): English "Alolan" (its adjective), other languages the region's name. */
  formRegion(id: string): string;
  /** The games named by their ids ("gold", "heartgold"), as a list. */
  games(ids: readonly string[]): string;
  /** A decimal as the language writes it (at most one digit after the point). */
  num(n: number): string;
  /** "A and B and C" (English, as it always read) / the language's own list. */
  and(items: readonly string[]): string;
  /** "A, B, C" / "A、B、C". */
  comma(items: readonly string[]): string;
}

/** A name's key in src/data/i18n: lower case, letters and digits only ("King's Rock" → "kingsrock"). */
export const dataKey = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const an = (word: string) => `${/^[AEIOU]/.test(word) ? "an" : "a"} ${word}`;

/** English's own adjectives for the regional forms. */
const REGION_ADJECTIVE: Record<string, string> = { alola: "Alolan", galar: "Galarian", hisui: "Hisuian", paldea: "Paldean" };

/** Compiles a message tree at run time: under plain Node (the tsx scripts) the JSON isn't compiled by the build. */
function compiled(tree: Tree): Tree {
  return Object.fromEntries(Object.entries(tree).map(([k, v]) => [k, typeof v === "string" ? (compile(v) as unknown as string) : compiled(v)]));
}

/** English: compiled to functions by the build and by vitest (scripts/i18n/icu-loader.cjs); plain strings under tsx. */
function englishT(): GroupsT {
  const raw = typeof (groups.en as unknown as Tree).type === "object" && typeof ((groups.en as unknown as Tree).type as Tree).label === "string" && /\{/.test(((groups.en as unknown as Tree).type as Tree).label as string);
  return raw ? translator(defineNamespace(groups.name, compiled(groups.en as unknown as Tree) as typeof groups.en), DEFAULT_LOCALE, undefined) : translator(groups, DEFAULT_LOCALE, undefined);
}

export const ENGLISH_KIT: Kit = {
  locale: DEFAULT_LOCALE,
  t: englishT(),
  a: an,
  type: cap,
  pokemon: (english) => english,
  ability: (s) => s,
  move: (s) => s,
  item: (s) => s,
  egg: (s) => s,
  colour: (c) => c,
  Colour: cap,
  stat: (k) => STAT_LABELS[k],
  genRegion: (g) => GENERATION_REGIONS[g],
  formRegion: (r) => REGION_ADJECTIVE[r] ?? cap(r),
  games: (ids) => ids.join(" and "),
  num: (n) => n.toLocaleString("en-US", { maximumFractionDigits: 1 }),
  and: (items) => items.join(" and "),
  comma: (items) => items.join(", "),
};

const MESSAGES: Record<Exclude<Locale, "en">, Tree> = { ja, es, fr, de, it } as unknown as Record<Exclude<Locale, "en">, Tree>;
/** The data's key for each stat. */
const STAT_KEY: Record<StatKey, string> = { hp: "hp", atk: "attack", def: "defense", spa: "specialattack", spd: "specialdefense", spe: "speed" };

const kits = new Map<Locale, Kit>([[DEFAULT_LOCALE, ENGLISH_KIT]]);

/** The kit of a language (English's for English). */
export function kitFor(locale: Locale): Kit {
  let kit = kits.get(locale);
  if (kit) return kit;
  const l = locale as Exclude<Locale, "en">;
  const data = LOCAL_NAMES[l];
  const look = (table: Record<string, string> | undefined, english: string) => table?.[dataKey(english)] ?? english;
  const lists = new Intl.ListFormat(INTL_LOCALE[l], { type: "conjunction" });
  const nums = new Intl.NumberFormat(INTL_LOCALE[l], { maximumFractionDigits: 1 });
  kit = {
    locale,
    t: translator(groups, locale, MESSAGES[l]),
    a: (w) => w,
    type: (id) => data.types[id] ?? cap(id),
    pokemon: (english, id) => data.species[id] ?? english,
    ability: (s) => look(data.abilities, s),
    move: (s) => look(data.moves, s),
    item: (s) => look(data.items, s),
    egg: (s) => look(data.eggGroups, s),
    colour: (c) => (l === "de" ? look(data.colors, c) : look(data.colors, c).toLowerCase()),
    Colour: (c) => cap(look(data.colors, c)),
    stat: (k) => data.stats[STAT_KEY[k]] ?? STAT_LABELS[k],
    genRegion: (g) => look(data.regions, GENERATION_REGIONS[g]),
    // As the language says "an Alolan form": "d'Alola" (forme d'Alola), "de Alola", "di Alola"; German and Japanese join the name itself.
    formRegion: (r) => {
      const n = look(data.regions, r);
      return l === "fr" ? (/^[AEIOU]/.test(n) ? `d'${n}` : `de ${n}`) : l === "es" ? `de ${n}` : l === "it" ? `di ${n}` : n;
    },
    games: (ids) => lists.format(ids.map((id) => data.versions[id] ?? id)),
    num: (n) => nums.format(n),
    and: (items) => lists.format(items),
    comma: (items) => items.join(l === "ja" ? "、" : ", "),
  };
  kits.set(locale, kit);
  return kit;
}
