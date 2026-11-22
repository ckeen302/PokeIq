import { ogT } from "@/lib/og/i18n";
import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/** Share card for /iq-test: the five-section test and the number it gives you. */

export const alt = "The PokéIQ Test: a cognitive test made of Pokémon, in five timed sections";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  const t = await ogT(props);
  return ogCard({
    eyebrow: t("iqTest.eyebrow"),
    title: [t("iqTest.title1"), [t("iqTest.title2"), C.violet]],
    subtitle: t("iqTest.subtitle"),
    accent: C.violet,
    visual: (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 420, padding: "34px 30px", borderRadius: 18, background: C.panel, border: `3px solid ${C.edge}` }}>
        <div style={{ display: "flex", fontFamily: "Silkscreen", fontSize: 22, color: C.muted }}>{t("iqTest.yours")}</div>
        <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: 150, lineHeight: 1, color: C.violet, marginTop: 10 }}>128</div>
        <div style={{ display: "flex", fontSize: 24, color: C.muted, marginTop: 10 }}>{t("iqTest.scored")}</div>
      </div>
    ),
    footer: t("iqTest.footer"),
    t,
  });
}
