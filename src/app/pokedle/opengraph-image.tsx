import { ogT } from "@/lib/og/i18n";
import { C, ClueTilesVisual, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/** Share card for /pokedle (spoiler-free: the board's colours only). */

export const alt = "Pokédle: guess the mystery Pokémon";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  const t = await ogT(props);
  return ogCard({
    eyebrow: t("pokedle.eyebrow"),
    title: [t("pokedle.title1"), [t("pokedle.title2"), C.violet], [t("pokedle.title3"), C.violet]],
    subtitle: t("pokedle.subtitle"),
    accent: C.violet,
    visual: <ClueTilesVisual />,
    footer: t("pokedle.footer"),
    t,
  });
}
