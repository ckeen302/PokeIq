import "server-only";
import { toRomaji } from "wanakana";
import type { Locale, OtherLocale } from "@/i18n/config";
import type { Translator } from "@/i18n/catalog";
import neaCats from "@/messages/nea-cats";
import formsData from "@/data/about-forms.json";
import typesJa from "@/data/i18n/ja/types.json";
import typesEs from "@/data/i18n/es/types.json";
import typesFr from "@/data/i18n/fr/types.json";
import typesDe from "@/data/i18n/de/types.json";
import typesIt from "@/data/i18n/it/types.json";
import regionsJa from "@/data/i18n/ja/regions.json";
import regionsEs from "@/data/i18n/es/regions.json";
import regionsFr from "@/data/i18n/fr/regions.json";
import regionsDe from "@/data/i18n/de/regions.json";
import regionsIt from "@/data/i18n/it/regions.json";
import { speciesAliases, speciesName } from "@/lib/names/species";
import { POKEDEX, getPokemon } from "@/lib/pokemon/pokedex";
import { NEA_CATEGORIES, NEA_GEN_REGIONS, type NeaCategory } from "./categories";
import { neaOutsiders, neaTargets } from "./targets";
import type { NeaOutsider, NeaTarget } from "./types";

/**
 * Name 'em All in the page's language, on the server: category names and page copy (official type and region names
 * from src/data/i18n), and each slot's name there with the other names it answers to (English, and for Japanese
 * rōmaji). English pages use the English data as it always was; nothing here reaches a browser except the strings
 * a page in another language sends.
 */

type T = Translator<typeof neaCats.en>;
type Names = Record<string, string>;

const TYPES: Record<OtherLocale, Names> = { ja: typesJa, es: typesEs, fr: typesFr, de: typesDe, it: typesIt };
const REGIONS: Record<OtherLocale, Names> = { ja: regionsJa, es: regionsEs, fr: regionsFr, de: regionsDe, it: regionsIt };

type CatKey = keyof typeof neaCats.en.cats;
type DexKey = keyof typeof neaCats.en.dex;

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** A region's official name in the language ("Unova" → "Teselia"). */
export function regionName(english: string, locale: Locale): string {
  return locale === "en" ? english : (REGIONS[locale][english.toLowerCase()] ?? english);
}

export interface NeaCategoryText {
  label: string;
  h1: string;
  title: string;
  description: string;
}

/** A category's label, heading, title and description in the translator's language (English: exactly categories.ts'). */
export function categoryText(cat: NeaCategory, t: T): NeaCategoryText {
  const locale = t.locale;
  if (cat.group === "all") return { label: t("all.label"), h1: t("all.h1"), title: t("all.title"), description: t("all.description") };
  if (cat.group === "gen") {
    const n = Number(cat.id.slice(4));
    const v = { n, region: regionName(NEA_GEN_REGIONS[n - 1], locale) };
    return { label: t("gen.label", v), h1: t("gen.h1", v), title: t("gen.title", v), description: t("gen.description", v) };
  }
  if (cat.group === "type") {
    const id = cat.id.slice(5);
    const v = { type: locale === "en" ? cap(id) : (TYPES[locale][id] ?? cap(id)) };
    return { label: t("type.label", v), h1: t("type.h1", v), title: t("type.title", v), description: t("type.description", v) };
  }
  if (cat.group === "dex") {
    const id = cat.id as DexKey;
    return { label: t(`dex.${id}.label`), h1: t(`dex.${id}.h1`), title: t(`dex.${id}.title`), description: t(`dex.${id}.description`) };
  }
  const id = cat.id as CatKey;
  return { label: t(`cats.${id}.label`), h1: t(`cats.${id}.h1`), title: t(`cats.${id}.title`), description: t(`cats.${id}.description`) };
}

/** Every category's label in the translator's language, by id. */
export function categoryLabels(t: T): Record<string, string> {
  return Object.fromEntries(NEA_CATEGORIES.map((c) => [c.id, categoryText(c, t).label]));
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

type FormRow = [id: number, species: number, slug: string, name: string, kind: string];
const FORM_SLUG = new Map((formsData as FormRow[]).map((r) => [r[0], r[2]]));

/** A form's name in the language, from its slug and its species' name there ("vulpix-alola" → "Vulpix de Alola"). */
export function formName(slug: string, speciesSlug: string, name: string, t: T): string {
  const parts = slug.slice(speciesSlug.length + 1).split("-");
  const has = (p: string) => parts.includes(p);
  if (has("mega")) {
    const variant = parts[parts.indexOf("mega") + 1];
    return variant ? t("form.megaVariant", { name, variant: variant.toUpperCase() }) : t("form.mega", { name });
  }
  if (has("gmax")) {
    if (has("single")) return t("form.gmaxStyle.single", { name });
    if (has("rapid")) return t("form.gmaxStyle.rapid", { name });
    if (has("amped")) return t("form.gmaxStyle.amped", { name });
    if (has("low")) return t("form.gmaxStyle.lowkey", { name });
    return t("form.gmax", { name });
  }
  if (has("breed")) {
    const breed = parts[parts.indexOf("breed") - 1] as "combat" | "blaze" | "aqua";
    return t("form.breed", { name, breed: t(`form.breeds.${breed}`) });
  }
  if (has("standard")) return t("form.darmanitan.standard", { name });
  if (has("zen")) return t("form.darmanitan.zen", { name });
  if (has("alola")) return t("form.alola", { name });
  if (has("galar")) return t("form.galar", { name });
  if (has("hisui")) return t("form.hisui", { name });
  return t("form.paldea", { name });
}

/** The language's words for a form's prefix ("Méga", "Gigamax", the region's name), and for Japanese their rōmaji. */
function prefixWords(form: NonNullable<NeaTarget["form"]>, t: T, locale: OtherLocale): string[] {
  const words = form.kind === "mega" ? [t("words.mega")] : form.kind === "gmax" ? t("words.gmax").split("|") : [regionName(form.region ?? "", locale)];
  // Rōmaji as typed with the long vowel doubled or not: アローラ → "aroora", "arora".
  return locale === "ja" ? without([...words, ...words.flatMap((w) => [toRomaji(w), toRomaji(w.replace(/ー/g, ""))])]) : words;
}

/** Without the names a slot already answers to. */
const without = (list: string[], ...drop: string[]) => [...new Set(list)].filter((a) => a && !drop.includes(a));

function localTarget(target: NeaTarget, t: T, locale: OtherLocale): NeaTarget {
  if (!target.form) {
    const own = speciesName(target.species, target.name, locale);
    return { ...target, name: own, aliases: speciesAliases(target.species, target.name, locale) };
  }
  const sp = getPokemon(target.species)!;
  const base = speciesName(sp.id, sp.name, locale);
  const own = formName(FORM_SLUG.get(target.id) ?? sp.slug, sp.slug, base, t);
  return {
    ...target,
    name: own,
    aliases: without([target.name], own),
    form: { ...target.form, bases: without([base, ...speciesAliases(sp.id, sp.name, locale)], sp.name), prefixes: prefixWords(target.form, t, locale) },
  };
}

const slotCache = new Map<string, NeaTarget[]>();
const outsiderCache = new Map<string, NeaOutsider[]>();

/** A category's slots in the translator's language (English: neaTargets' own), or null for an unknown category. */
export function localTargets(id: string, t: T): NeaTarget[] | null {
  const list = neaTargets(id);
  const locale = t.locale;
  if (!list || locale === "en") return list;
  const key = `${locale}:${id}`;
  let out = slotCache.get(key);
  if (!out) slotCache.set(key, (out = list.map((x) => localTarget(x, t, locale))));
  return out;
}

const BY_NAME = new Map(POKEDEX.map((p) => [p.name, p]));

/** The species outside a category in the translator's language: [its name there, the other names it answers to]. */
export function localOutsiders(id: string, t: T): NeaOutsider[] {
  const names = neaOutsiders(id);
  const locale = t.locale;
  if (locale === "en") return names;
  const key = `${locale}:${id}`;
  let out = outsiderCache.get(key);
  if (!out) {
    out = names.map((n) => {
      const p = BY_NAME.get(n);
      return p ? [speciesName(p.id, p.name, locale), ...speciesAliases(p.id, p.name, locale)] : n;
    });
    outsiderCache.set(key, out);
  }
  return out;
}
