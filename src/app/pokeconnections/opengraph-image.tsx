import { ogT } from "@/lib/og/i18n";
import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { TilesVisual } from "@/lib/og/result";

/** Share card for /pokeconnections (spoiler-free: a made-up board's colours only). */

export const alt = "PokéConnections: find the four groups of Pokémon";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  const t = await ogT(props);
  return ogCard({
    eyebrow: t("connections.eyebrow"),
    title: [t("connections.title1"), [t("connections.title2"), C.violet], [t("connections.title3"), C.violet]],
    subtitle: t("connections.subtitle"),
    accent: C.violet,
    visual: (
      <TilesVisual
        accent={C.violet}
        tiles={[
          ["conn-green", "conn-blue", "conn-green", "conn-green"],
          ["conn-yellow", "conn-yellow", "conn-yellow", "conn-yellow"],
          ["conn-green", "conn-green", "conn-green", "conn-green"],
          ["conn-blue", "conn-purple", "conn-blue", "conn-blue"],
          ["conn-blue", "conn-blue", "conn-blue", "conn-blue"],
          ["conn-purple", "conn-purple", "conn-purple", "conn-purple"],
        ]}
      />
    ),
    footer: t("connections.footer"),
    t,
  });
}
