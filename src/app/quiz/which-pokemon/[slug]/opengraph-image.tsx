import { OG_CONTENT_TYPE, OG_SIZE, ogCard, visualLength } from "@/lib/og/card";
import { ogT } from "@/lib/og/i18n";
import { wpName, wpText } from "@/lib/which-pokemon/i18n";
import { ResultVisual } from "@/lib/og/which-pokemon";
import { typeColor } from "@/lib/pokemon/type-colors";
import { POOL, pooledBySlug } from "@/lib/which-pokemon/pool";
import { nameOf, typesOf } from "@/lib/which-pokemon/match";

/** Link preview for a result page: "I got Gengar", with the artwork. */

export const alt = "A Which Pokémon Are You? result on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params: Promise<{ slug: string }> }) {
  const t = await ogT(props);
  const pokemon = pooledBySlug((await props.params).slug) ?? POOL[0];
  const en = t.locale === "en";
  const name = en ? nameOf(pokemon) : wpName(pokemon.id, t.locale);
  const accent = typeColor(typesOf(pokemon)[0] ?? "normal");
  return ogCard({
    eyebrow: t("whichPokemon.result.eyebrow"),
    title: [t("whichPokemon.result.title"), [name, accent]],
    titleSize: visualLength(name) > 10 ? 72 : 96,
    subtitle: t("whichPokemon.result.subtitle", { title: wpText(pokemon, t.locale).title }),
    accent,
    visual: <ResultVisual pokemon={pokemon} locale={t.locale} />,
    footer: t("whichPokemon.result.footer"),
    t,
  });
}
