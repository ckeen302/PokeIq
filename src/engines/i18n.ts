import { INTL_LOCALE, translator, type Translator, type Tree } from "@/i18n/catalog";
import { isLiveLocale, type OtherLocale } from "@/i18n/config";

import { getPokemon, POKEDEX, type Pokemon } from "@/lib/pokemon/pokedex";
import type { HandwrittenWording } from "./trivia/bank";
import type { StatKey } from "@/lib/pokemon/constants";
import quiz from "@/messages/quiz-engine";

/**
 * The words a quiz question is written with in a language other than English: the "quiz-engine" messages and the
 * official names (src/data/i18n, from PokéAPI; Pokémon from src/data/pokedex.json; people, badges and teams from
 * src/data/quiz/i18n), plus the games' own Pokédex entries and descriptions in that language.
 *
 * Server-only and loaded on demand (`loadQuizLang`, once per language per server), so English runs never load any of
 * it: English questions are built exactly as they always were, and a run in another language is the same run,
 * re-worded (see ./localize.ts).
 */

export type QuizT = Translator<typeof quiz.en>;

type Table = Record<string, string>;
type Texts = Record<string, { text: string; versions: string[] }[]>;
type NameKind = "abilities" | "moves" | "items" | "locations" | "regions" | "genus" | "stats" | "versions" | "damageClasses" | "types";

export interface QuizLang {
  locale: OtherLocale;
  t: QuizT;
  /** A Pokémon's official name, by Pokédex number. */
  pokemon(p: Pokemon | number): string | undefined;
  /** A Pokémon's official name from its English name ("Mr. Mime", "Jangmo-o", "Sirfetch'd"). */
  pokemonNamed(english: string): string | undefined;
  /** An official name from the language's data table, by English name (undefined when the table lacks it). */
  name(kind: NameKind, english: string): string | undefined;
  /** A type by its id ("fire"). */
  type(id: string): string;
  /** A typing, as the language writes two types ("Feu / Vol", "ほのお・ひこう"). */
  typing(types: readonly string[]): string;
  stat(key: StatKey | "bst"): string;
  /** A game's title from its English title ("Pokémon Red and Blue"), or undefined when it can't be written. */
  game(english: string): string | undefined;
  /** A person (Gym Leader, rival, anime character), team, Badge or other proper name from src/data/quiz/i18n. */
  proper(english: string, context?: "games" | "anime"): string | undefined;
  /** The Pokédex entries of a species in this language (none after Generation 8). */
  entries(id: number): string[];
  /** The games' description of an Ability or item, by English name. */
  description(kind: "abilities" | "items", english: string): string | undefined;
  /** A hand-written trivia question's translation (src/data/quiz/<bank>/i18n/<locale>.json), if it has one. */
  handwritten(bank: "games" | "anime", id: string): HandwrittenWording | undefined;
  /** An anime league's name, as the language's sentences use it (with its article where the language has one). */
  league(english: string): string | undefined;
  /** "A, B and C" as the language lists things. */
  and(items: readonly string[]): string;
  /** "A or B". */
  or(items: readonly string[]): string;
  /** A decimal as the language writes it. */
  num(n: number, digits?: number): string;
}

/** A name's key in src/data/i18n: lower case, letters and digits only ("King's Rock" → "kingsrock"). */
export const dataKey = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

const BY_ENGLISH = new Map<string, Pokemon>();
for (const p of POKEDEX) {
  BY_ENGLISH.set(dataKey(p.name), p);
  if (!BY_ENGLISH.has(dataKey(p.slug))) BY_ENGLISH.set(dataKey(p.slug), p);
}
/** Showdown and table spellings that differ from the Pokédex's. */
const SPELLINGS: Record<string, string> = { nidoranf: "nidoran♀", nidoranm: "nidoran♂" };

export function pokemonByEnglish(english: string): Pokemon | undefined {
  const key = dataKey(english);
  return BY_ENGLISH.get(key) ?? BY_ENGLISH.get(dataKey(SPELLINGS[key] ?? "")) ?? undefined;
}

/** Ability and item numbers in PokéAPI (the descriptions' keys), by English name key. */
interface PokeApiIds {
  abilities: Table;
  items: Table;
}

interface LangData {
  messages: Tree | undefined;
  tables: Record<NameKind, Table>;
  proper: { games: Table; anime: Table };
  species: Texts;
  abilities: Texts;
  items: Texts;
  ids: PokeApiIds;
  trivia: { games: Record<string, HandwrittenWording>; anime: Record<string, HandwrittenWording>; leagues: Table };
}

interface BankTranslation {
  questions?: Record<string, HandwrittenWording>;
  leagues?: Table;
}

/** A bank's translation in a language (a language may have none yet: its questions are then swapped). */
async function bankTranslation(bank: "games" | "anime", l: OtherLocale): Promise<BankTranslation> {
  try {
    if (bank === "games") return ((await import(`@/data/quiz/games/i18n/${l}.json`)) as { default: BankTranslation }).default;
    return ((await import(`@/data/quiz/anime/i18n/${l}.json`)) as { default: BankTranslation }).default;
  } catch {
    return {};
  }
}

async function loadData(l: OtherLocale): Promise<LangData> {
  const json = async <T,>(p: Promise<{ default: unknown }>) => (await p).default as T;
  const [messages, abilities, moves, items, locations, regions, genus, stats, versions, damageClasses, types, proper, species, abilityTexts, itemTexts, ids, gamesBank, animeBank] = await Promise.all([
    json<Tree>(import(`@/messages/${l}/quiz-engine.json`)),
    json<Table>(import(`@/data/i18n/${l}/abilities.json`)),
    json<Table>(import(`@/data/i18n/${l}/moves.json`)),
    json<Table>(import(`@/data/i18n/${l}/items.json`)),
    json<Table>(import(`@/data/i18n/${l}/locations.json`)),
    json<Table>(import(`@/data/i18n/${l}/regions.json`)),
    json<Table>(import(`@/data/i18n/${l}/genus.json`)),
    json<Table>(import(`@/data/i18n/${l}/stats.json`)),
    json<Table>(import(`@/data/i18n/${l}/versions.json`)),
    json<Table>(import(`@/data/i18n/${l}/damage-classes.json`)),
    json<Table>(import(`@/data/i18n/${l}/types.json`)),
    json<Record<string, Record<string, string>>>(import("@/data/quiz/i18n/names.json")),
    json<Texts>(import(`@/data/i18n/${l}/texts/species.json`)),
    json<Texts>(import(`@/data/i18n/${l}/texts/abilities.json`)),
    json<Texts>(import(`@/data/i18n/${l}/texts/items.json`)),
    json<PokeApiIds>(import("@/data/quiz/i18n/pokeapi-ids.json")),
    bankTranslation("games", l),
    bankTranslation("anime", l),
  ]);
  const games: Table = {};
  const anime: Table = {};
  for (const [english, row] of Object.entries(proper)) {
    if (row[l]) games[english] = row[l];
    const a = row[`${l}@anime`] ?? row[l];
    if (a) anime[english] = a;
  }
  return {
    messages,
    tables: { abilities, moves, items, locations, regions, genus, stats, versions, damageClasses, types },
    proper: { games, anime },
    species,
    abilities: abilityTexts,
    items: itemTexts,
    ids,
    trivia: { games: gamesBank.questions ?? {}, anime: animeBank.questions ?? {}, leagues: animeBank.leagues ?? {} },
  };
}

const STAT_KEY: Record<StatKey, string> = { hp: "hp", atk: "attack", def: "defense", spa: "specialattack", spd: "specialdefense", spe: "speed" };

/** One game's words: "Let's Go, Pikachu!" and the Legends titles hold commas and "and" of their own. */
const WHOLE_TITLES: Record<string, string> = {
  "let's go, pikachu!": "letsgopikachu",
  "let's go, eevee!": "letsgoeevee",
  "legends: arceus": "legendsarceus",
  "legends: z-a": "legendsza",
};

/** The version keys a title names: "Pokémon Red, Blue and Yellow" → red, blue, yellow. */
export function titleVersions(english: string): string[] | null {
  let rest = english.trim();
  if (!/^Pokémon:? /.test(rest)) return null;
  rest = rest.replace(/^Pokémon:? /, "");
  const found: string[] = [];
  // Whole titles first, then the plain colours and stones split on commas, "and" and "&".
  const parts: string[] = [];
  let s = rest.toLowerCase();
  for (const [title, key] of Object.entries(WHOLE_TITLES)) {
    if (s.includes(title)) {
      s = s.replace(title, `\u0000${key}\u0000`);
    }
  }
  for (const piece of s.split(/\s*(?:,|\band\b|&)\s*/)) {
    const p = piece.replace(/\u0000/g, "").trim();
    if (p) parts.push(p);
  }
  for (const p of parts) found.push(dataKey(p));
  return found.length ? found : null;
}

function buildLang(l: OtherLocale, data: LangData): QuizLang {
  const t = translator(quiz, l, data.messages);
  const lists = new Intl.ListFormat(INTL_LOCALE[l], { type: "conjunction" });
  const ors = new Intl.ListFormat(INTL_LOCALE[l], { type: "disjunction" });
  const look = (kind: NameKind, english: string) => data.tables[kind][dataKey(english)];
  const pokemon = (p: Pokemon | number) => {
    const mon = typeof p === "number" ? getPokemon(p) : p;
    return mon?.names[l];
  };
  const game = (english: string): string | undefined => {
    const keys = titleVersions(english);
    if (!keys) return undefined;
    // The first games are Red and Green in Japan: the West's Red and Blue are those games.
    const jaFirst = l === "ja" && keys[0] === "red" && keys[1] === "blue";
    const names = keys.map((k, i) => (jaFirst && i === 1 ? data.tables.versions.green : k === "legendsza" && l === "ja" ? "LEGENDS Z-A" : data.tables.versions[k]));
    if (jaFirst && keys.length > 2) names.splice(2, 0, data.tables.versions.blue);
    if (names.some((n) => !n)) return undefined;
    if (l === "ja") {
      const legends = keys.length === 1 && keys[0].startsWith("legends");
      return legends ? `『Pokémon ${names[0]}』` : `『ポケットモンスター ${names.join("・")}』`;
    }
    return `Pokémon ${lists.format(names)}`;
  };
  return {
    locale: l,
    t,
    pokemon,
    pokemonNamed: (english) => {
      const p = pokemonByEnglish(english);
      return p ? pokemon(p) : undefined;
    },
    name: look,
    type: (id) => data.tables.types[id.toLowerCase()] ?? id,
    typing: (types) => types.map((id) => data.tables.types[id.toLowerCase()] ?? id).join(l === "ja" ? "・" : " / "),
    stat: (key) => (key === "bst" ? t("stat.bst") : (data.tables.stats[STAT_KEY[key]] ?? key)),
    game,
    proper: (english, context = "games") => data.proper[context][english],
    entries: (id) => (data.species[String(id)] ?? []).map((e) => e.text),
    description: (kind, english) => {
      const id = data.ids[kind][dataKey(english)];
      return id ? data[kind][id]?.[0]?.text : undefined;
    },
    handwritten: (bank, id) => data.trivia[bank][id],
    league: (english) => data.trivia.leagues[english],
    and: (items) => lists.format(items),
    or: (items) => ors.format(items),
    num: (n, digits = 1) => n.toLocaleString(INTL_LOCALE[l], { minimumFractionDigits: digits, maximumFractionDigits: digits }),
  };
}

const loaded = new Map<OtherLocale, QuizLang>();
const loading = new Map<OtherLocale, Promise<QuizLang>>();

/** Loads a language's quiz words (once per server). Call before building a run's questions in that language. */
export function loadQuizLang(locale: string | undefined): Promise<QuizLang | null> {
  if (!locale || locale === "en" || !isLiveLocale(locale)) return Promise.resolve(null);
  const l = locale as OtherLocale;
  let p = loading.get(l);
  if (!p) {
    p = loadData(l).then((data) => {
      const lang = buildLang(l, data);
      loaded.set(l, lang);
      return lang;
    });
    loading.set(l, p);
    p.catch(() => loading.delete(l));
  }
  return p;
}

/** A language's words if they're loaded already (null for English, or while they load). */
export function quizLangIfLoaded(locale: string | undefined): QuizLang | null {
  if (!locale || locale === "en" || !isLiveLocale(locale)) return null;
  return loaded.get(locale as OtherLocale) ?? null;
}

/**
 * A loaded language's words, synchronously. Throws when the language was asked for but not loaded: a question must
 * never come out differently because a request happened to run before the data arrived (grading re-derives it).
 */
export function quizLang(locale: string | undefined): QuizLang | null {
  if (!locale || locale === "en" || !isLiveLocale(locale)) return null;
  const lang = loaded.get(locale as OtherLocale);
  if (!lang) throw new Error(`Quiz language ${locale} used before loadQuizLang`);
  return lang;
}
