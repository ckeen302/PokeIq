"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@/i18n/locale-context";
import type { Locale } from "@/i18n/config";

/**
 * Battle names (Pokémon, moves, abilities, items, types, natures) in the page's language, for the client: the
 * battle data (@pkmn, the damage calc, usage stats) speaks Showdown's English, and what a page in another language
 * shows goes through these. English pages get the names back untouched and load nothing; another language loads its
 * own tables (src/data/i18n/<locale>) once, on the first page that asks, and shows English until they arrive.
 * Teams, sets and exports stay in Showdown's English: only what is shown is translated.
 */
export interface BattleNames {
  locale: Locale;
  /** "Garchomp" → "Carchacrok"; a forme keeps Showdown's suffix ("Rotom-Wash" → "Motisma-Wash"). */
  species(name: string): string;
  move(name: string): string;
  ability(name: string): string;
  item(name: string): string;
  /** A type by its Showdown name ("Fire"). */
  type(name: string): string;
  nature(name: string): string;
}

type Table = Record<string, string>;
interface Tables {
  species: Table;
  moves: Table;
  abilities: Table;
  items: Table;
  types: Table;
  natures: Table;
}

/** A name's key in src/data/i18n: the English, without accents, lower case letters and digits only. */
export const nameKey = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const same = (s: string) => s;
const ENGLISH: BattleNames = { locale: "en", species: same, move: same, ability: same, item: same, type: same, nature: same };

const loads = new Map<string, Promise<Tables | null>>();
function load(locale: string): Promise<Tables | null> {
  // An English-only build never has another language: no chunk, no request.
  if (!process.env.LIVE_LOCALES) return Promise.resolve(null);
  let p = loads.get(locale);
  if (!p) {
    const json = (m: Promise<{ default: unknown }>) => m.then((x) => x.default as Table);
    p = Promise.all([
      json(import(`@/data/i18n/${locale}/species.json`)),
      json(import(`@/data/i18n/${locale}/moves.json`)),
      json(import(`@/data/i18n/${locale}/abilities.json`)),
      json(import(`@/data/i18n/${locale}/items.json`)),
      json(import(`@/data/i18n/${locale}/types.json`)),
      json(import(`@/data/i18n/${locale}/natures.json`)),
    ]).then(
      ([species, moves, abilities, items, types, natures]) => ({ species, moves, abilities, items, types, natures }),
      () => {
        loads.delete(locale);
        return null;
      }
    );
    loads.set(locale, p);
  }
  return p;
}

const cache = new Map<string, BattleNames>();
function namesOf(locale: Locale, t: Tables): BattleNames {
  const hit = cache.get(locale);
  if (hit) return hit;
  const pick = (table: Table) => (s: string) => (s ? (table[nameKey(s)] ?? s) : s);
  const species = (name: string) => {
    if (!name) return name;
    const whole = t.species[nameKey(name)];
    if (whole) return whole;
    // "Mr. Mime-Galar": the longest hyphenated start that is a species, then Showdown's forme.
    const parts = name.split("-");
    for (let i = parts.length - 1; i > 0; i--) {
      const base = t.species[nameKey(parts.slice(0, i).join("-"))];
      if (base) return `${base}-${parts.slice(i).join("-")}`;
    }
    return name;
  };
  const out: BattleNames = { locale, species, move: pick(t.moves), ability: pick(t.abilities), item: pick(t.items), type: pick(t.types), nature: pick(t.natures) };
  cache.set(locale, out);
  return out;
}

/** The page's battle names: identity on English pages; another language's once its tables have loaded. */
export function useBattleNames(): BattleNames {
  const locale = useLocale();
  const [names, setNames] = useState<BattleNames | null>(() => (locale === "en" ? ENGLISH : (cache.get(locale) ?? null)));
  useEffect(() => {
    if (locale === "en") return setNames(ENGLISH);
    let live = true;
    void load(locale).then((t) => live && t && setNames(namesOf(locale, t)));
    return () => {
      live = false;
    };
  }, [locale]);
  const fallback = useMemo<BattleNames>(() => ({ ...ENGLISH, locale }), [locale]);
  return names ?? fallback;
}

/** A field effect's name, Showdown's move (Gravity) or ability (Beads of Ruin), in the page's language. */
export function effectName(names: BattleNames, label: string): string {
  const move = names.move(label);
  return move !== label ? move : names.ability(label);
}
