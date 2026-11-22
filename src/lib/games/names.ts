import "server-only";
import type { Locale } from "@/i18n/config";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { speciesAliases, speciesName } from "@/lib/names/species";
import TYPES_JA from "@/data/i18n/ja/types.json";
import TYPES_ES from "@/data/i18n/es/types.json";
import TYPES_FR from "@/data/i18n/fr/types.json";
import TYPES_DE from "@/data/i18n/de/types.json";
import TYPES_IT from "@/data/i18n/it/types.json";
import type { Athlete } from "./athlete";
import { GAMES_ATHLETES } from "./data";

/**
 * The Games' athletes in the page's language (server only). A Pokémon is its species' official name; a Mega or a
 * regional form is the species' official name in that language's own pattern (Méga-Dracaufeu X, Raichu d'Alola,
 * Alola-Raichu…); every other form (Attack Deoxys, Heat Rotom…) and the few regional forms with a breed or a mode
 * in their name keep their English name, which has no official translation in our data. English is untouched.
 */

const ENGLISH_SPECIES = new Map(POKEDEX.map((p) => [p.id, p.name]));

type Region = "alola" | "galar" | "hisui" | "paldea";
const REGIONAL: Record<Exclude<Locale, "en">, (name: string, r: Region) => string> = {
  ja: (n, r) => `${n}（${{ alola: "アローラ", galar: "ガラル", hisui: "ヒスイ", paldea: "パルデア" }[r]}のすがた）`,
  es: (n, r) => `${n} de ${{ alola: "Alola", galar: "Galar", hisui: "Hisui", paldea: "Paldea" }[r]}`,
  fr: (n, r) => `${n} ${{ alola: "d’Alola", galar: "de Galar", hisui: "de Hisui", paldea: "de Paldea" }[r]}`,
  de: (n, r) => `${{ alola: "Alola", galar: "Galar", hisui: "Hisui", paldea: "Paldea" }[r]}-${n}`,
  it: (n, r) => `${n} di ${{ alola: "Alola", galar: "Galar", hisui: "Hisui", paldea: "Paldea" }[r]}`,
};
const MEGA: Record<Exclude<Locale, "en">, (name: string) => string> = {
  ja: (n) => `メガ${n}`,
  es: (n) => `Mega-${n}`,
  fr: (n) => `Méga-${n}`,
  de: (n) => `Mega-${n}`,
  it: (n) => `Mega${n}`,
};

/** An athlete's name in the language. */
export function athleteName(a: Pick<Athlete, "key" | "name" | "entrant">, locale: Locale): string {
  if (locale === "en") return a.name;
  const id = a.entrant.species;
  const english = ENGLISH_SPECIES.get(id) ?? a.name;
  const own = speciesName(id, english, locale);
  const kind = a.entrant.kind;
  if (kind === "pokemon") return own;
  if (kind === "mega") {
    const m = /-mega(?:-([xy]))?$/.exec(a.key);
    if (!m) return a.name;
    return `${MEGA[locale](own)}${m[1] ? (locale === "ja" ? m[1].toUpperCase() : ` ${m[1].toUpperCase()}`) : ""}`;
  }
  if (kind === "regional") {
    const m = /-(alola|galar|hisui|paldea)$/.exec(a.key);
    return m ? REGIONAL[locale](own, m[1] as Region) : a.name;
  }
  return a.name;
}

export interface GamesNames {
  /** Every athlete's name in the language, by key. */
  names: Record<string, string>;
  /** Other names a search box takes for an athlete: its English name, and for Japanese the rōmaji. */
  aliases: Record<string, string[]>;
}

const cache = new Map<Locale, GamesNames>();
/** The whole roster's names in a language other than English (sent to the 3D pages, which fetch English rows). */
export function gamesNames(locale: Locale): GamesNames | null {
  if (locale === "en") return null;
  let out = cache.get(locale);
  if (!out) {
    const names: Record<string, string> = {};
    const aliases: Record<string, string[]> = {};
    for (const a of GAMES_ATHLETES) {
      const n = athleteName(a, locale);
      if (n === a.name) continue;
      names[a.key] = n;
      const extra = a.entrant.kind === "pokemon" ? speciesAliases(a.entrant.species, a.name, locale).filter((x) => x !== a.name) : [];
      aliases[a.key] = [a.name, ...extra];
    }
    out = { names, aliases };
    cache.set(locale, out);
  }
  return out;
}

const TYPES: Record<Exclude<Locale, "en">, Record<string, string>> = { ja: TYPES_JA, es: TYPES_ES, fr: TYPES_FR, de: TYPES_DE, it: TYPES_IT };
/** A type's official name in the language ("fire" → "Fuego"); English capitalised as before. */
export function typeName(type: string, locale: Locale): string {
  if (locale === "en") return type[0].toUpperCase() + type.slice(1);
  return TYPES[locale][type] ?? type[0].toUpperCase() + type.slice(1);
}

/** Every type's name in the language, for the nations picker (null in English). */
export function typeNames(locale: Locale): Record<string, string> | null {
  return locale === "en" ? null : TYPES[locale];
}
