import { C, OG_CONTENT_TYPE, OG_SIZE, ScreenshotVisual, localImage, ogCard } from "@/lib/og/card";
import { guessrResultCard } from "@/lib/og/guessr";
import { challengeShareView } from "@/lib/server/geo-share";
import { readGeoChallenge } from "@/lib/server/geo";

/**
 * Preview card for a PokéGuessr challenge link (Discord, X, iMessage…): the
 * friend's score and a square per round on the map they played, in the same
 * card as a shared result. Never a place.
 */

export const runtime = "nodejs";
export const alt = "A PokéGuessr challenge: same places, beat the score";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  let challenge: ReturnType<typeof readGeoChallenge> = null;
  try {
    challenge = readGeoChallenge(decodeURIComponent((await params).token));
  } catch {
    challenge = null;
  }
  const view = challenge ? challengeShareView(challenge) : null;
  if (view) return guessrResultCard(view);
  // A broken or tampered link still gets a proper card, never an error.
  const [shot, map] = await Promise.all([localImage("src/assets/guessr/galar.webp", 940), localImage("public/geo/maps/world-thumb.webp", 336)]);
  return ogCard({
    eyebrow: "PokéGuessr challenge",
    title: ["Where in the", ["world is this?", C.green]],
    subtitle: "GeoGuessr for Pokémon: real in-game screenshots, Kanto to Paldea.",
    accent: C.green,
    visual: <ScreenshotVisual src={shot} map={map} pin={null} />,
    footer: "Same places · can you beat it? →",
  });
}
