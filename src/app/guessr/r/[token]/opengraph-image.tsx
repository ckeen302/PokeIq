import { C, OG_CONTENT_TYPE, OG_SIZE, ScreenshotVisual, localImage, ogCard } from "@/lib/og/card";
import { guessrResultCard } from "@/lib/og/guessr";
import { readGeoShare } from "@/lib/server/geo-share";
import { geoWorldPin } from "@/lib/server/geo";

/** Preview card for a shared PokéGuessr result (/guessr/r/<token>): the map played, a square per round, the total. */

export const runtime = "nodejs";
export const alt = "A PokéGuessr result: open the link to beat it";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  let raw = "";
  try {
    raw = decodeURIComponent((await params).token);
  } catch {
    // A malformed escape: the generic card below.
  }
  const view = raw ? await readGeoShare(raw) : null;
  if (view) return guessrResultCard(view);
  // A broken or tampered link still gets a proper card, never an error.
  const [shot, map] = await Promise.all([localImage("src/assets/guessr/galar.webp", 940), localImage("public/geo/maps/world-thumb.webp", 336)]);
  return ogCard({
    eyebrow: "PokéGuessr",
    title: ["Where in the", ["world is this?", C.green]],
    subtitle: "GeoGuessr for Pokémon: real in-game screenshots, Kanto to Paldea.",
    accent: C.green,
    visual: <ScreenshotVisual src={shot} map={map} pin={geoWorldPin("Galar", "Postwick")} />,
    footer: "Drop a pin · up to 25,000 points →",
  });
}
