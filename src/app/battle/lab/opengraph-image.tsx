import { C, OG_CONTENT_TYPE, OG_SIZE, WinOddsVisual, ogCard } from "@/lib/og/card";
import { ogT } from "@/lib/og/i18n";

/** Share card for the Battle Lab. */

export const alt = "Battle Lab: Pokémon win odds from thousands of simulated battles";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  const t = await ogT(props);
  return ogCard({
    eyebrow: t("battleLab.eyebrow"),
    title: [t("battleLab.title1"), [t("battleLab.title2"), C.cyan]],
    subtitle: t("battleLab.subtitle"),
    accent: C.cyan,
    visual: <WinOddsVisual t={t} />,
    footer: t("battleLab.footer"),
    t,
  });
}
