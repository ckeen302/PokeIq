import { OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { ResultVisual } from "@/lib/og/which-pokemon";
import { typeColor } from "@/lib/pokemon/type-colors";
import { POOL, pooledBySlug } from "@/lib/which-pokemon/pool";
import { nameOf, typesOf } from "@/lib/which-pokemon/match";

/** Link preview for a result page: "I got Gengar", with the artwork. */

export const alt = "A Which Pokémon Are You? result on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const pokemon = pooledBySlug((await params).slug) ?? POOL[0];
  const name = nameOf(pokemon);
  const accent = typeColor(typesOf(pokemon)[0] ?? "normal");
  return ogCard({
    eyebrow: "Which Pokémon are you?",
    title: ["I got", [name, accent]],
    titleSize: name.length > 10 ? 72 : 96,
    subtitle: `${pokemon.title}. 18 questions, 200 possible results. Which one are you?`,
    accent,
    visual: <ResultVisual pokemon={pokemon} />,
    footer: "Take the quiz · free · no sign-up →",
  });
}
