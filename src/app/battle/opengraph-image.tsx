import { BattleVisual, C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { ogT } from "@/lib/og/i18n";
import { ogNames } from "@/lib/og/names";

/** Share card for the battle hub (and its team builder, calc and setup pages). */

export const alt = "Pokémon battles on Pokémon Showdown's engine";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  const t = await ogT(props);
  const names = await ogNames(t.locale);
  const [foe, you] = t.locale === "en" ? [undefined, undefined] : [names.species(485, "Heatran").toUpperCase(), names.species(445, "Garchomp").toUpperCase()];
  return ogCard({
    eyebrow: t("battle.eyebrow"),
    title: [t("battle.title1"), [t("battle.title2"), C.pink]],
    subtitle: t("battle.subtitle"),
    accent: C.pink,
    visual: <BattleVisual foe={foe} you={you} t={t} />,
    footer: t("battle.footer"),
    t,
  });
}
