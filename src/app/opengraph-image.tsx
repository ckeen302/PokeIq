import { ogT } from "@/lib/og/i18n";
import { C, OG_CONTENT_TYPE, OG_SIZE, ScreenshotVisual, localImage, ogCard } from "@/lib/og/card";

/** The site's share card: what PokéIQ is, over a real PokéGuessr view. */

export const alt = "PokéIQ: PokéGuessr, Pokédle, Pokémon battles and quizzes";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  const t = await ogT(props);
  const [shot, map] = await Promise.all([localImage("src/assets/guessr/paldea.webp", 940), localImage("public/geo/maps/world-thumb.webp", 336)]);
  return ogCard({
    eyebrow: t("home.eyebrow"),
    title: [[t("home.title1"), C.green], [t("home.title2"), C.violet], [t("home.title3"), C.pink]],
    titleSize: 56,
    subtitle: t("home.subtitle"),
    accent: C.green,
    visual: <ScreenshotVisual src={shot} map={map} pin={null} t={t} />,
    chips: ["PokéGuessr", "Pokédle", t("home.chips.battles"), t("home.chips.battleLab"), t("home.chips.quizzes")],
    t,
  });
}
