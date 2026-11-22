import { ogT } from "@/lib/og/i18n";
import { C, OG_CONTENT_TYPE, OG_SIZE, ScreenshotVisual, localImage, ogCard } from "@/lib/og/card";

/** Share card for /pokeguessr. */

export const alt = "PokéGuessr: GeoGuessr for Pokémon, with real in-game screenshots";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  const t = await ogT(props);
  const [shot, map] = await Promise.all([localImage("src/assets/guessr/galar.webp", 940), localImage("public/geo/maps/world-thumb.webp", 336)]);
  return ogCard({
    eyebrow: t("guessr.eyebrow"),
    title: [t("guessr.title1"), [t("guessr.title2"), C.green]],
    subtitle: t("guessr.subtitle"),
    accent: C.green,
    visual: <ScreenshotVisual src={shot} map={map} pin={null} t={t} />,
    footer: t("guessr.footer"),
    t,
  });
}
