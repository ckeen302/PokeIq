import type { Locale } from "@/i18n/config";

/**
 * Showdown's English names (species, moves, items, abilities) in a page's official language names, for client code
 * on battle pages in another language: the language's own tables only (src/data/i18n/<locale>), loaded once, on
 * demand. English pages never call it (and an English-only build drops the import). A name without an official one
 * stays as Showdown writes it; a form keeps its English suffix after its species' name ("ロトム-Wash").
 */

type Table = Record<string, string>;

export interface BattleNames {
  species(name: string): string;
  move(name: string): string;
  item(name: string): string;
  ability(name: string): string;
}

/** A name's key in src/data/i18n: lower case letters and digits ("U-turn" → "uturn", "Nidoran-F" → "nidoranf"). */
const key = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const from = (table: Table) => (name: string) => (name && table[key(name)]) || name;

function speciesFrom(table: Table) {
  return (name: string) => {
    if (!name) return name;
    const whole = table[key(name)];
    if (whole) return whole;
    // "Landorus-Therian", "Urshifu-Rapid-Strike": the longest leading part that is a species, then the form.
    const parts = name.split("-");
    for (let i = parts.length - 1; i > 0; i--) {
      const own = table[key(parts.slice(0, i).join("-"))];
      if (own) return `${own}-${parts.slice(i).join("-")}`;
    }
    return name;
  };
}

const cache = new Map<Locale, Promise<BattleNames>>();

export function loadBattleNames(locale: Exclude<Locale, "en">): Promise<BattleNames> {
  let p = cache.get(locale);
  if (!p) {
    const json = (m: Promise<{ default: Table }>) => m.then((x) => x.default);
    p = Promise.all([
      json(import(`@/data/i18n/${locale}/species.json`)),
      json(import(`@/data/i18n/${locale}/moves.json`)),
      json(import(`@/data/i18n/${locale}/items.json`)),
      json(import(`@/data/i18n/${locale}/abilities.json`)),
    ]).then(([species, moves, items, abilities]) => ({ species: speciesFrom(species), move: from(moves), item: from(items), ability: from(abilities) }));
    cache.set(locale, p);
    p.catch(() => cache.delete(locale));
  }
  return p;
}
