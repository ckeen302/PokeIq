import "server-only";
import { toRomaji } from "wanakana";
import type { Locale } from "@/i18n/config";
import { getLocale, serverT } from "@/i18n/server";
import type { Translator } from "@/i18n/catalog";
import sizesNames from "@/messages/sizes-names";
import { speciesAliases, speciesName } from "@/lib/names/species";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { SIZE_ITEMS } from "@/lib/sizes/data";
import type { SizeItem } from "@/lib/sizes/types";
import type { SizesLocal } from "./local-names";
import jaTypes from "@/data/i18n/ja/types.json";
import esTypes from "@/data/i18n/es/types.json";
import frTypes from "@/data/i18n/fr/types.json";
import deTypes from "@/data/i18n/de/types.json";
import itTypes from "@/data/i18n/it/types.json";

const TYPES: Partial<Record<Locale, Record<string, string>>> = { ja: jaTypes, es: esTypes, fr: frTypes, de: deTypes, it: itTypes };

/**
 * /pokedex/sizes in another language: every figure's name there (official species names; Megas, Gigantamax,
 * regional and Eternamax forms by the games' own patterns; the real-world references from the messages), the other
 * names its search accepts (English, and for Japanese the rōmaji), and the type names for the badges. Built once per
 * language on the server and sent only to pages in that language; English pages get none.
 */

type N = Translator<typeof sizesNames.en>;

const REGIONS = ["alola", "galar", "hisui", "paldea"] as const;

/** A Mega, Gigantamax, regional or Eternamax form's name from its slug and its species' name in the language. */
export function formName(slug: string, speciesSlug: string, name: string, t: N): string | null {
  const parts = slug.slice(speciesSlug.length + 1).split("-");
  const has = (p: string) => parts.includes(p);
  if (has("eternamax")) return t("form.eternamax", { name });
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
  const region = REGIONS.find(has);
  if (region) {
    if (has("breed")) {
      const breed = parts[parts.indexOf("breed") - 1];
      return breed === "combat" || breed === "blaze" || breed === "aqua" ? t("form.breed", { name, breed: t(`form.breeds.${breed}`) }) : null;
    }
    if (has("standard")) return t("form.darmanitan.standard", { name });
    if (has("zen")) return t("form.darmanitan.zen", { name });
    return t(`form.${region}`, { name });
  }
  return null;
}

/** A real-world reference's name ("ref-car" → the language's "Car"). */
function refName(i: SizeItem, t: N): string {
  const id = i.key.slice(4);
  return id === "phone" || id === "human" || id === "car" || id === "bus" || id === "house" || id === "building" ? t(`refs.${id}`) : i.name;
}

export interface Built {
  items: SizeItem[];
  byKey: Map<string, SizeItem>;
  local: SizesLocal;
}
const cache = new Map<Locale, Built>();

/** A language's figures, names and type names (`t`: its sizes-names messages). */
export function buildSizesLocal(locale: Locale, t: N): Built {
  const types = TYPES[locale] ?? {};
  const names: Record<string, string> = {};
  const alt: Record<string, string[]> = {};
  const items = SIZE_ITEMS.map((i) => {
    let own = i.name;
    const others = new Set<string>([i.name]);
    if (i.kind === "ref") own = refName(i, t);
    else if (i.kind === "pokemon") {
      own = speciesName(i.species, i.name, locale);
      for (const a of speciesAliases(i.species, i.name, locale)) others.add(a);
    } else {
      const sp = getPokemon(i.species);
      const f = sp ? formName(i.key, sp.slug, speciesName(sp.id, sp.name, locale), t) : null;
      if (f) {
        own = f;
        if (locale === "ja") others.add(toRomaji(f.replace(/[♀♂]/g, "")));
      }
    }
    others.delete(own);
    if (own !== i.name) names[i.key] = own;
    // The English name is the item's own on the wire: only the other spellings travel.
    others.delete(i.name);
    if (others.size && i.kind !== "ref") alt[i.key] = [...others];
    return own === i.name ? i : { ...i, name: own };
  });
  const typeNames: Record<string, string> = {};
  for (const ty of new Set(SIZE_ITEMS.flatMap((i) => i.types))) if (types[ty]) typeNames[ty] = types[ty];
  return { items, byKey: new Map(items.map((i) => [i.key, i])), local: { names, alt, types: typeNames } };
}

function built(): Built | null {
  const locale = getLocale();
  if (locale === "en") return null;
  let b = cache.get(locale);
  if (!b) cache.set(locale, (b = buildSizesLocal(locale, serverT(sizesNames))));
  return b;
}

/** Every figure with its name in the page's language (English pages: lib/sizes/data's own list). */
export function pageItems(): SizeItem[] {
  return built()?.items ?? SIZE_ITEMS;
}

/** A figure with its name in the page's language. */
export function pageItem<I extends SizeItem | undefined>(i: I): I {
  if (!i) return i;
  return (built()?.byKey.get(i.key) as I) ?? i;
}

/** What the page's client components need for its language (undefined on English pages: they send nothing). */
export function pageLocal(): SizesLocal | undefined {
  return built()?.local;
}
