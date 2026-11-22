import "server-only";
import type { OtherLocale } from "@/i18n/config";
import { serverT } from "@/i18n/server";
import pikadokuPage from "@/messages/pikadoku-page";
import DETAILS from "@/data/pokedex-details.json";
import { speciesAliases, speciesName } from "@/lib/names/species";
import { formName } from "@/lib/pikadoku/local";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { foldAny } from "./filter";
import { rosterSources } from "./roster.server";
import type { TierListLocal } from "./types";

/**
 * The Tier List Maker on a page in another language (server only; English pages send nothing): every roster entry's
 * official name there, and the other names its search takes (English, and rōmaji for Japanese), folded as the search
 * folds them. A form is named the way the site's Pokédex names it ("Méga-Dracaufeu X", "Raichu d’Alola"); a form
 * those names don't cover keeps its English name with the species' own name in it ("Prismillon (Polar)").
 */

const SLUGS = new Map<number, string>();
for (const forms of Object.values(DETAILS as unknown as Record<string, { forms?: { id: number; slug: string }[] }>)) {
  for (const f of forms.forms ?? []) SLUGS.set(f.id, f.slug);
}

const cache = new Map<OtherLocale, TierListLocal>();

export function tierListLocal(locale: OtherLocale): TierListLocal {
  const hit = cache.get(locale);
  if (hit) return hit;
  const pdk = serverT(pikadokuPage);
  const names: Record<string, string> = {};
  const alt: Record<string, string> = {};
  const english = new Map<string, string>();
  for (const m of rosterSources()) {
    const baseEnglish = m.s ? (english.get(m.s) ?? getPokemon(m.d)?.name ?? m.n) : m.n;
    if (!m.s) english.set(m.k, m.n);
    const base = speciesName(m.d, baseEnglish, locale);
    let name = base;
    if (m.f || m.s) {
      const slug = m.pokeapi ? SLUGS.get(m.pokeapi) : undefined;
      const speciesSlug = getPokemon(m.d)?.slug;
      name = (slug && speciesSlug && slug.startsWith(`${speciesSlug}-`) ? formName(slug, speciesSlug, base, pdk) : null) ?? m.n.replace(baseEnglish, base);
    }
    names[m.k] = name;
    const others = [m.n, ...(name === base || m.n.includes(baseEnglish) ? speciesAliases(m.d, baseEnglish, locale) : [])];
    alt[m.k] = [...new Set(others.map(foldAny).filter((a) => a && a !== foldAny(name)))].join(" ");
  }
  const out = { names, alt };
  cache.set(locale, out);
  return out;
}
