/* eslint-disable jsx-a11y/alt-text -- Satori draws plain <img> */
import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { artworkUrl } from "@/lib/pokemon/pokedex";

/** Link preview for the quiz itself: three very different possible results. */

export const alt = "Which Pokémon Are You? A personality quiz on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogCard({
    eyebrow: "Personality quiz",
    title: ["Which Pokémon", ["are you?", C.violet]],
    subtitle: "18 questions. 200 possible Pokémon, every profile grounded in the Pokédex.",
    accent: C.violet,
    visual: (
      <div style={{ display: "flex", alignItems: "flex-end" }}>
        {[25, 94, 143].map((id, i) => (
          <img key={id} src={artworkUrl(id)} width={i === 1 ? 240 : 180} height={i === 1 ? 240 : 180} style={{ marginLeft: i ? -30 : 0 }} />
        ))}
      </div>
    ),
    footer: "Free · no sign-up · share card included →",
  });
}
