import "server-only";
import type { Locale } from "@/i18n/config";
import type { Translator } from "@/i18n/catalog";
import { speciesAliases, speciesName } from "@/lib/names/species";
import { megaName, regionalName, type Region } from "@/lib/games/names";
import { nameKey } from "@/lib/geo-i18n";
import type mbPages from "@/messages/mass-battle-pages";
import mbPagesEn from "@/messages/en/mass-battle-pages.json";
import { buildRoster } from "./roster-data";
import { ITEM_GROUPS, NATURE_NAMES } from "./sets";
import { TYPE_NAMES, type MBSpecies } from "./types";
import MOVES_JA from "@/data/i18n/ja/moves.json";
import ABILITIES_JA from "@/data/i18n/ja/abilities.json";
import ITEMS_JA from "@/data/i18n/ja/items.json";
import NATURES_JA from "@/data/i18n/ja/natures.json";
import TYPES_JA from "@/data/i18n/ja/types.json";
import MOVES_ES from "@/data/i18n/es/moves.json";
import ABILITIES_ES from "@/data/i18n/es/abilities.json";
import ITEMS_ES from "@/data/i18n/es/items.json";
import NATURES_ES from "@/data/i18n/es/natures.json";
import TYPES_ES from "@/data/i18n/es/types.json";
import MOVES_FR from "@/data/i18n/fr/moves.json";
import ABILITIES_FR from "@/data/i18n/fr/abilities.json";
import ITEMS_FR from "@/data/i18n/fr/items.json";
import NATURES_FR from "@/data/i18n/fr/natures.json";
import TYPES_FR from "@/data/i18n/fr/types.json";
import MOVES_DE from "@/data/i18n/de/moves.json";
import ABILITIES_DE from "@/data/i18n/de/abilities.json";
import ITEMS_DE from "@/data/i18n/de/items.json";
import NATURES_DE from "@/data/i18n/de/natures.json";
import TYPES_DE from "@/data/i18n/de/types.json";
import MOVES_IT from "@/data/i18n/it/moves.json";
import ABILITIES_IT from "@/data/i18n/it/abilities.json";
import ITEMS_IT from "@/data/i18n/it/items.json";
import NATURES_IT from "@/data/i18n/it/natures.json";
import TYPES_IT from "@/data/i18n/it/types.json";
import type { PickerRow, PresetCardData } from "./page-data";

/**
 * Mass Battle in the page's language (server only). The roster the battle fetches (/api/mass-battle/roster) stays
 * English (the damage calculator reads its names); a page in another language sends, once, the names it shows:
 * species (official, forms in the language's pattern), moves, abilities, held items, natures and types, from
 * src/data/i18n. Anything without an official name keeps its English one. English pages send nothing extra.
 */

type Names = Record<string, string>;
type Other = Exclude<Locale, "en">;
type Kinds = { moves: Names; abilities: Names; items: Names; natures: Names; types: Names };

const DATA: Record<Other, Kinds> = {
  ja: { moves: MOVES_JA, abilities: ABILITIES_JA, items: ITEMS_JA, natures: NATURES_JA, types: TYPES_JA },
  es: { moves: MOVES_ES, abilities: ABILITIES_ES, items: ITEMS_ES, natures: NATURES_ES, types: TYPES_ES },
  fr: { moves: MOVES_FR, abilities: ABILITIES_FR, items: ITEMS_FR, natures: NATURES_FR, types: TYPES_FR },
  de: { moves: MOVES_DE, abilities: ABILITIES_DE, items: ITEMS_DE, natures: NATURES_DE, types: TYPES_DE },
  it: { moves: MOVES_IT, abilities: ABILITIES_IT, items: ITEMS_IT, natures: NATURES_IT, types: TYPES_IT },
};

/** A species' name in the language (Megas and regional forms in its own pattern; other forms as they are). */
export function mbSpeciesName(s: Pick<MBSpecies, "id" | "of" | "slug" | "name" | "form">, englishOf: (id: number) => string, locale: Locale): string {
  if (locale === "en") return s.name;
  const own = speciesName(s.of, englishOf(s.of), locale);
  if (!s.form) return s.id === s.of ? own : s.name;
  if (s.form === "mega") return megaName(own, /-mega-([xy])$/.exec(s.slug)?.[1], locale);
  if (["alola", "galar", "hisui", "paldea"].includes(s.form) && new RegExp(`-${s.form}$`).test(s.slug)) return regionalName(own, s.form as Region, locale);
  return s.name;
}

/** What a page in another language sends the battle's client components. */
export interface MbNames {
  /** By the English name: moves, abilities, items, natures, types. */
  moves: Names;
  abilities: Names;
  items: Names;
  natures: Names;
  types: Names;
}

const cache = new Map<Other, { names: MbNames; species: Map<number, string>; aka: Map<number, string[]> }>();

function build(locale: Other) {
  let c = cache.get(locale);
  if (c) return c;
  const roster = buildRoster();
  const english = new Map(roster.species.filter((s) => s.id === s.of).map((s) => [s.id, s.name]));
  const englishOf = (id: number) => english.get(id) ?? "";
  const data = DATA[locale];
  const pick = (from: Names, list: Iterable<string>): Names => {
    const out: Names = {};
    for (const n of list) {
      const v = from[nameKey(n)];
      if (v && v !== n) out[n] = v;
    }
    return out;
  };
  const species = new Map<number, string>();
  const aka = new Map<number, string[]>();
  for (const s of roster.species) {
    const own = mbSpeciesName(s, englishOf, locale);
    species.set(s.id, own);
    const extra = s.id === s.of ? speciesAliases(s.of, s.name, locale).filter((x) => x !== s.name) : [];
    aka.set(s.id, own === s.name ? extra : [s.name, ...extra]);
  }
  const items = new Set([...ITEM_GROUPS.flatMap((g) => g.items), ...roster.species.map((s) => s.item).filter(Boolean)]);
  const names: MbNames = {
    moves: pick(data.moves, roster.moves.map((m) => m.name)),
    abilities: pick(data.abilities, new Set(roster.species.flatMap((s) => s.abilities))),
    items: pick(data.items, items),
    natures: pick(data.natures, NATURE_NAMES),
    types: pick(data.types, TYPE_NAMES),
  };
  c = { names, species, aka };
  cache.set(locale, c);
  return c;
}

/** The names for a page in another language (null in English). */
export function mbNames(locale: Locale): MbNames | null {
  return locale === "en" ? null : build(locale).names;
}

/** The pickers' list in the language: each Pokémon's name there, and the English (and rōmaji) it also answers to. English as it is. */
export function localPickerList(list: PickerRow[], locale: Locale): PickerRow[] {
  if (locale === "en") return list;
  const { species, aka } = build(locale);
  return list.map((p) => ({ ...p, name: species.get(p.id) ?? p.name, aka: aka.get(p.id) ?? [] }));
}

/** A species' name by id in the language (English as the roster has it). */
export function mbNameOf(locale: Locale, englishOf: (id: number) => string): (id: number) => string {
  if (locale === "en") return englishOf;
  const { species } = build(locale);
  return (id) => species.get(id) ?? englishOf(id);
}

/** A ready-made battle's words in the page's language. */
export function localPreset<P extends Pick<PresetCardData, "id" | "title" | "hook" | "blurb" | "labels">>(p: P, t: Translator<typeof mbPages.en>): P {
  if (t.locale === "en") return p;
  const id = p.id as keyof typeof mbPages.en.presets;
  if (!(id in mbPagesEn.presets)) return p;
  const two = id as "kanto-starters";
  return {
    ...p,
    title: t(`presets.${id}.title`),
    hook: t(`presets.${id}.hook`),
    blurb: t(`presets.${id}.blurb`),
    labels: p.labels ? [t(`presets.${two}.a`), t(`presets.${two}.b`)] : null,
  };
}
