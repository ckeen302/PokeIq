import { C, OG_CONTENT_TYPE, OG_SIZE, ScreenshotVisual, localImage, ogCard } from "@/lib/og/card";
import { guessrResultCard } from "@/lib/og/guessr";
import { challengeShareView } from "@/lib/server/geo-share";
import { readGeoChallenge } from "@/lib/server/geo";
import { ogT } from "@/lib/og/i18n";

/**
 * Preview card for a PokéGuessr challenge link (Discord, X, iMessage…): the
 * friend's score and a square per round on the map they played, in the same
 * card as a shared result. Never a place.
 */

export const runtime = "nodejs";
export const alt = "A PokéGuessr challenge: same places, beat the score";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params: Promise<{ token: string }> }) {
  const t = await ogT(props);
  let challenge: ReturnType<typeof readGeoChallenge> = null;
  try {
    challenge = readGeoChallenge(decodeURIComponent((await props.params).token));
  } catch {
    challenge = null;
  }
  const view = challenge ? challengeShareView(challenge) : null;
  if (view && challenge) return guessrResultCard(view, t, challenge);
  // A broken or tampered link still gets a proper card, never an error.
  const [shot, map] = await Promise.all([localImage("src/assets/guessr/galar.webp", 940), localImage("public/geo/maps/world-thumb.webp", 336)]);
  return ogCard({
    eyebrow: t("guessr.challenge.fallbackEyebrow"),
    title: [t("guessr.title1"), [t("guessr.title2"), C.green]],
    subtitle: t("guessr.fallbackSubtitle"),
    accent: C.green,
    visual: <ScreenshotVisual src={shot} map={map} pin={null} t={t} />,
    footer: t("guessr.challenge.fallbackFooter"),
    t,
  });
}
