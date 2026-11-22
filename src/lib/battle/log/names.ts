import { Dex } from "@pkmn/dex";
import type { OtherLocale } from "@/i18n/config";

/**
 * A battle's names (Pokémon, moves, abilities, items, types, natures) in the page's language, from that language's
 * src/data/i18n/<locale>/battle-names.json (scripts/i18n/battle-names.mjs). The battle protocol, the simulator's
 * requests and @pkmn/dex all speak English; these turn an English name into the official one. A name the language
 * has no official translation for stays English.
 */

export interface BattleNameTable {
  /** By National Dex number. */
  species: Record<string, string>;
  /** By data key: the English name in lower case, letters and digits only. */
  moves: Record<string, string>;
  abilities: Record<string, string>;
  items: Record<string, string>;
  types: Record<string, string>;
  natures: Record<string, string>;
}

export interface BattleNames {
  move(english: string): string;
  ability(english: string): string;
  item(english: string): string;
  type(english: string): string;
  nature(english: string): string;
  /** A species or forme by its English name: the species' own name in the language (a forme's is its species'). */
  species(english: string): string;
  /** A Pokémon's name as the battle shows it: its species' name when it has no nickname of its own. */
  pokemon(name: string): string;
  /** An effect's name, whatever it is: a move, an ability, an item, a type, or a Pokémon. */
  effect(english: string): string;
}

/** A name's key in src/data/i18n: the English, without accents, lower case letters and digits only. */
export const nameKey = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const same = (s: string) => s;

/** English: every name as the battle sends it. */
export const ENGLISH_NAMES: BattleNames = {
  move: same,
  ability: same,
  item: same,
  type: same,
  nature: same,
  species: same,
  pokemon: same,
  effect: same,
};

export function battleNames(table: BattleNameTable): BattleNames {
  const look = (t: Record<string, string>, english: string) => (english ? t[nameKey(english)] : undefined);
  const type = (english: string) => look(table.types, english) ?? english;
  const move = (english: string) => {
    const own = look(table.moves, english);
    if (own) return own;
    // "Hidden Power Fire": the move's own name, with its type.
    const hp = /^Hidden Power (\w+)$/.exec(english);
    const base = hp && look(table.moves, "Hidden Power");
    return base ? `${base} (${type(hp[1])})` : english;
  };
  const ability = (english: string) => look(table.abilities, english) ?? english;
  const item = (english: string) => look(table.items, english) ?? english;
  const species = (english: string) => {
    const sp = english ? Dex.species.get(english) : undefined;
    if (!sp?.exists) return english;
    const base = sp.forme ? Dex.species.get(sp.baseSpecies) : sp;
    const own = table.species[String(base.num)];
    // The languages' tables name species, not formes: a forme goes by its species' name (its sprite shows which).
    return own ?? english;
  };
  return {
    move,
    ability,
    item,
    type,
    nature: (english) => look(table.natures, english) ?? english,
    species,
    pokemon: (name) => {
      const sp = name ? Dex.species.get(name) : undefined;
      // A nickname of its own stays as it is; the name Showdown gives a Pokémon without one is its species'.
      if (!sp?.exists || (name !== sp.name && name !== sp.baseSpecies)) return name;
      return name === sp.baseSpecies ? species(sp.baseSpecies) : species(name);
    },
    effect: (english) => look(table.moves, english) ?? look(table.abilities, english) ?? look(table.items, english) ?? look(table.types, english) ?? english,
  };
}

const LOADERS: Record<OtherLocale, () => Promise<{ default: unknown }>> = {
  ja: () => import("@/data/i18n/ja/battle-names.json"),
  es: () => import("@/data/i18n/es/battle-names.json"),
  fr: () => import("@/data/i18n/fr/battle-names.json"),
  de: () => import("@/data/i18n/de/battle-names.json"),
  it: () => import("@/data/i18n/it/battle-names.json"),
};

const loads = new Map<OtherLocale, Promise<BattleNames>>();

/** The language's names, fetched once (only ever another language's: English pages never call this). */
export function loadBattleNames(locale: OtherLocale): Promise<BattleNames> {
  let p = loads.get(locale);
  if (!p) {
    p = LOADERS[locale]()
      .then((m) => battleNames(m.default as BattleNameTable))
      .catch(() => {
        loads.delete(locale);
        return ENGLISH_NAMES;
      });
    loads.set(locale, p);
  }
  return p;
}
