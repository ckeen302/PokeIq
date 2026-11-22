import { ogT } from "@/lib/og/i18n";
import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/** Share card for /pikadoku (spoiler-free: no grid, no answers). */

export const alt = "Pikadoku: Pokémon Sudoku, a Pokémon grid game";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  const t = await ogT(props);
  return ogCard({
    eyebrow: t("pikadoku.eyebrow"),
    title: [t("pikadoku.title1"), [t("pikadoku.title2"), C.violet]],
    subtitle: t("pikadoku.subtitle"),
    accent: C.violet,
    footer: t("pikadoku.footer"),
    t,
  });
}
