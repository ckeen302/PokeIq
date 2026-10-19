import { C, OG_CONTENT_TYPE, OG_SIZE, ScreenshotVisual, localImage, ogCard } from "@/lib/og/card";
import { geoStats, geoWorldPin } from "@/lib/server/geo";

/** Share card for /guessr. */

export const alt = "PokéGuessr: GeoGuessr for Pokémon, with real in-game screenshots";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  const [shot, map] = await Promise.all([localImage("src/assets/guessr/galar.webp", 940), localImage("public/geo/maps/world-thumb.webp", 336)]);
  const stats = geoStats();
  return ogCard({
    eyebrow: "PokéGuessr · new daily game",
    title: ["Where in the", ["world is this?", C.green]],
    subtitle: `GeoGuessr for Pokémon: ${stats.screenshots.toLocaleString("en-US")} real in-game screenshots of ${stats.places.toLocaleString("en-US")} places, Kanto to Paldea.`,
    accent: C.green,
    visual: <ScreenshotVisual src={shot} map={map} pin={geoWorldPin("Galar", "Postwick")} />,
    footer: "Drop a pin · up to 25,000 points →",
  });
}
