import "server-only";
import { toRomaji } from "wanakana";
import type { Locale } from "@/i18n/config";
import { translator, type Translator, type Tree } from "@/i18n/catalog";
import page from "@/messages/pikadoku-page";
import pikadoku from "@/messages/pikadoku";
import { speciesAliases, speciesName } from "@/lib/names/species";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { allFacts } from "./categories";
import { PDK_CATALOG } from "./catalog";
import type { PdkLocal } from "./types";
import { WEEK_THEME_IDS } from "./weeks";

/**
 * What a Pikadoku page in another language sends its client components (types.ts' PdkLocal): every category's label
 * and every pickable Pokémon's name in that language, built once per language on the server. English pages get none.
 */

type T = Translator<typeof page.en>;
type Names = Record<string, string>;

/** A name as the data files key it: lower case, letters and digits ("Will-O-Wisp" → "willowisp"). */
const dataKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const REGIONS = ["alola", "galar", "hisui", "paldea"] as const;

/** A category's label in the page's language: official type, move and ability names, the rest from the messages. */
export function categoryLabel(id: string, english: string, t: T, data: { types: Names; moves: Names; abilities: Names }): string {
  const i = id.indexOf(":");
  const kind = id.slice(0, i);
  const rest = id.slice(i + 1);
  if (kind === "type") return data.types[rest] ?? english;
  if (kind === "move") return data.moves[dataKey(rest)] ?? english;
  if (kind === "ability" && rest !== "hidden") return data.abilities[dataKey(rest)] ?? english;
  const key = `cat.${id.replace(/:/g, "_")}`;
  return t.has(key) ? t(key as Parameters<T>[0]) : english;
}

/**
 * A playable form's name in the page's language, from its slug and its species' name there ("raichu-alola" →
 * "Raichu de Alola"); null when the form is not one of those Pikadoku names (its English name is shown).
 */
export function formName(slug: string, speciesSlug: string, species: string, t: T): string | null {
  const parts = slug.slice(speciesSlug.length + 1).split("-");
  const has = (p: string) => parts.includes(p);
  const name = species;
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
      if (breed === "combat" || breed === "blaze" || breed === "aqua") return t("form.breed", { name, breed: t(`form.breeds.${breed}`) });
      return null;
    }
    if (has("standard")) return t("form.darmanitan.standard", { name });
    if (has("zen")) return t("form.darmanitan.zen", { name });
    return t(`form.${region}`, { name });
  }
  if (has("crowned")) return speciesSlug === "zacian" || speciesSlug === "zamazenta" ? t(`form.crowned.${speciesSlug}`, { name }) : null;
  for (const k of ["starter", "primal", "origin", "eternal"] as const) if (has(k)) return t(`form.${k}`, { name });
  return null;
}

const cache = new Map<Locale, Promise<PdkLocal>>();

/** The page's Pikadoku words in its language; undefined on English pages (they send nothing). */
export function pikadokuLocal(locale: Locale): Promise<PdkLocal> | undefined {
  if (locale === "en") return undefined;
  let p = cache.get(locale);
  if (!p) {
    p = build(locale);
    cache.set(locale, p);
    p.catch(() => cache.delete(locale));
  }
  return p;
}

async function build(locale: Exclude<Locale, "en">): Promise<PdkLocal> {
  const [t, tw, types, moves, abilities] = await Promise.all([
    // The language's file of the namespace, read directly (one import per language: the same file getT would load).
    import(`@/messages/${locale}/pikadoku-page.json`).then((m) => translator(page, locale, m.default as Tree)),
    import(`@/messages/${locale}/pikadoku.json`).then((m) => translator(pikadoku, locale, m.default as Tree)),
    import(`@/data/i18n/${locale}/types.json`).then((m) => m.default as Names),
    import(`@/data/i18n/${locale}/moves.json`).then((m) => m.default as Names),
    import(`@/data/i18n/${locale}/abilities.json`).then((m) => m.default as Names),
  ]);
  const labels: Record<string, string> = {};
  for (const c of PDK_CATALOG) labels[c.id] = categoryLabel(c.id, c.label, t, { types, moves, abilities });

  const names: Record<number, string[]> = {};
  const put = (id: number, english: string, own: string, others: string[]) => {
    const extra = [...new Set(others)].filter((a) => a !== english && a !== own);
    if (own !== english || extra.length) names[id] = [own, ...extra];
  };
  const bySpecies = new Map(POKEDEX.map((p) => [p.id, p]));
  for (const p of POKEDEX) put(p.id, p.name, speciesName(p.id, p.name, locale), speciesAliases(p.id, p.name, locale));
  for (const f of allFacts()) {
    if (!f.form || !f.slug) continue;
    const sp = bySpecies.get(f.baseId);
    if (!sp) continue;
    const own = formName(f.slug, sp.slug, speciesName(sp.id, sp.name, locale), t) ?? f.name;
    put(f.id, f.name, own, locale === "ja" ? [toRomaji(own.replace(/[♀♂]/g, ""))] : []);
  }
  const themes: PdkLocal["themes"] = {};
  for (const id of WEEK_THEME_IDS) themes[id] = { name: tw(`weeklyTheme.${id}.name`), blurb: tw(`weeklyTheme.${id}.blurb`) };
  return { labels, names, themes };
}
