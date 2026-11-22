/* eslint-disable jsx-a11y/alt-text -- Satori draws plain <img> */
import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { artworkUrl } from "@/lib/pokemon/pokedex";
import { ogT } from "@/lib/og/i18n";

/** Link preview for the quiz itself: three very different possible results. */

export const alt = "Which Pokémon Are You? A personality quiz on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  const t = await ogT(props);
  return ogCard({
    eyebrow: t("whichPokemon.eyebrow"),
    title: [t("whichPokemon.title1"), [t("whichPokemon.title2"), C.violet]],
    subtitle: t("whichPokemon.subtitle"),
    accent: C.violet,
    visual: (
      <div style={{ display: "flex", alignItems: "flex-end" }}>
        {[25, 94, 143].map((id, i) => (
          <img key={id} src={artworkUrl(id)} width={i === 1 ? 240 : 180} height={i === 1 ? 240 : 180} style={{ marginLeft: i ? -30 : 0 }} />
        ))}
      </div>
    ),
    footer: t("whichPokemon.footer"),
    t,
  });
}
