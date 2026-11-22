import "server-only";
import { toRomaji } from "wanakana";
import type { Locale } from "@/i18n/config";
import type { Translator } from "@/i18n/catalog";
import { getLocale, serverT } from "@/i18n/server";
import sizesNames from "@/messages/sizes-names";
import { speciesAliases, speciesName } from "@/lib/names/species";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { RACE_ENTRANTS } from "@/lib/race/data";
import type { Entrant } from "@/lib/race/types";
import { formName } from "@/components/sizes/local";
import type { RaceLocal } from "./local-names";
import jaTypes from "@/data/i18n/ja/types.json";
import esTypes from "@/data/i18n/es/types.json";
import frTypes from "@/data/i18n/fr/types.json";
import deTypes from "@/data/i18n/de/types.json";
import itTypes from "@/data/i18n/it/types.json";

/**
 * /pokedex/race in another language: every runner's name there (official species names; Megas and regional forms by
 * the games' own patterns; the other alternate forms keep their English names, which the data has no translation
 * for), the other names the picker accepts (English, and for Japanese the rōmaji) and the type names for the lane
 * introductions. Built once per language on the server and sent only to pages in that language.
 */

const TYPES: Partial<Record<Locale, Record<string, string>>> = { ja: jaTypes, es: esTypes, fr: frTypes, de: deTypes, it: itTypes };

export interface RaceBuilt {
  entrants: Entrant[];
  byKey: Map<string, Entrant>;
  local: RaceLocal;
}
const cache = new Map<Locale, RaceBuilt>();

/** A language's runners, names and type names (`t`: its sizes-names messages). */
export function buildRaceLocal(locale: Locale, t: Translator<typeof sizesNames.en>): RaceBuilt {
  const names: Record<string, string> = {};
  const alt: Record<string, string[]> = {};
  const entrants = RACE_ENTRANTS.map((e) => {
    let own = e.name;
    const others = new Set<string>();
    if (e.kind === "pokemon") {
      own = speciesName(e.species, e.name, locale);
      for (const a of speciesAliases(e.species, e.name, locale)) others.add(a);
    } else if (e.kind === "mega" || e.kind === "regional") {
      const sp = getPokemon(e.species);
      const f = sp ? formName(e.key, sp.slug, speciesName(sp.id, sp.name, locale), t) : null;
      if (f) {
        own = f;
        if (locale === "ja") others.add(toRomaji(f.replace(/[♀♂]/g, "")));
      }
    }
    others.delete(own);
    others.delete(e.name);
    if (own !== e.name) names[e.key] = own;
    if (others.size) alt[e.key] = [...others];
    return own === e.name ? e : { ...e, name: own };
  });
  const all = TYPES[locale] ?? {};
  const types: Record<string, string> = {};
  for (const ty of new Set(RACE_ENTRANTS.flatMap((e) => e.types))) if (all[ty]) types[ty] = all[ty];
  return { entrants, byKey: new Map(entrants.map((e) => [e.key, e])), local: { names, alt, types } };
}

function built(): RaceBuilt | null {
  const locale = getLocale();
  if (locale === "en") return null;
  let b = cache.get(locale);
  if (!b) cache.set(locale, (b = buildRaceLocal(locale, serverT(sizesNames))));
  return b;
}

/** Every runner with its name in the page's language (English pages: lib/race/data's own list). */
export function pageEntrants(): Entrant[] {
  return built()?.entrants ?? RACE_ENTRANTS;
}

/** What the page's client components need for its language (undefined on English pages). */
export function pageRaceLocal(): RaceLocal | undefined {
  return built()?.local;
}
