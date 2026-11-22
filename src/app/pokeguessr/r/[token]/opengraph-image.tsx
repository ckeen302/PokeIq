import { C, OG_CONTENT_TYPE, OG_SIZE, ScreenshotVisual, localImage, ogCard } from "@/lib/og/card";
import { guessrResultCard } from "@/lib/og/guessr";
import { readGeoShare } from "@/lib/server/geo-share";
import { ogT } from "@/lib/og/i18n";

/** Preview card for a shared PokéGuessr result (/pokeguessr/r/<token>): the map played, a square per round, the total. */

export const runtime = "nodejs";
export const alt = "A PokéGuessr result: open the link to beat it";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params: Promise<{ token: string }> }) {
  const t = await ogT(props);
  let raw = "";
  try {
    raw = decodeURIComponent((await props.params).token);
  } catch {
    // A malformed escape: the generic card below.
  }
  const view = raw ? await readGeoShare(raw) : null;
  if (view) return guessrResultCard(view, t);
  // A broken or tampered link still gets a proper card, never an error.
  const [shot, map] = await Promise.all([localImage("src/assets/guessr/galar.webp", 940), localImage("public/geo/maps/world-thumb.webp", 336)]);
  return ogCard({
    eyebrow: "PokéGuessr",
    title: [t("guessr.title1"), [t("guessr.title2"), C.green]],
    subtitle: t("guessr.fallbackSubtitle"),
    accent: C.green,
    visual: <ScreenshotVisual src={shot} map={map} pin={null} t={t} />,
    footer: t("guessr.footer"),
    t,
  });
}
