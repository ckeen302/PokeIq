import { C, OG_CONTENT_TYPE, OG_SIZE, TypesVisual, ogCard } from "@/lib/og/card";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { TYPE_COLORS, typeTextColor } from "@/lib/pokemon/type-colors";
import { ogT } from "@/lib/og/i18n";
import { ogNames } from "@/lib/og/names";

/** Share card for the Pokédex and study mode. */

export const alt = "The PokéIQ Pokédex: every Pokémon, Kanto to Paldea";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  const t = await ogT(props);
  const names = await ogNames(t.locale);
  const types = Object.keys(TYPE_COLORS).map((type): [string, string, string] => [names.type(type), TYPE_COLORS[type], typeTextColor(type)]);
  return ogCard({
    eyebrow: t("pokedex.eyebrow"),
    // Other languages say "all" without the count (no "N Pokémon" counts in their copy).
    title: [t.locale === "en" ? t("pokedex.title1", { n: POKEDEX.length.toLocaleString("en-US") }) : t("pokedex.titleAll"), [t("pokedex.title2"), C.cyan]],
    subtitle: t("pokedex.subtitle"),
    accent: C.cyan,
    visual: <TypesVisual colors={types} />,
    footer: t("pokedex.footer"),
    t,
  });
}
