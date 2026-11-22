import { ogT } from "@/lib/og/i18n";
import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { TilesVisual } from "@/lib/og/result";

/** Share card for /daily: ten questions, the same for everyone (a made-up board, never a real day's). */

export const alt = "The PokéIQ Daily Challenge: ten Pokémon questions, the same for every trainer";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  const t = await ogT(props);
  return ogCard({
    eyebrow: t("daily.eyebrow"),
    title: [t("daily.title1"), [t("daily.title2"), C.pink], [t("daily.title3"), C.pink]],
    subtitle: t("daily.subtitle"),
    accent: C.pink,
    visual: <TilesVisual tiles={[["hit", "hit", "wrong", "hit", "hit"], ["hit", "wrong", "hit", "hit", "hit"]]} accent={C.pink} />,
    footer: t("daily.footer"),
    t,
  });
}
