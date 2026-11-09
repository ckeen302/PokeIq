import { C, OG_CONTENT_TYPE, OG_SIZE, ScreenshotVisual, localImage, ogCard } from "@/lib/og/card";

/** Share card for /guessr. */

export const alt = "PokéGuessr: GeoGuessr for Pokémon, with real in-game screenshots";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  const [shot, map] = await Promise.all([localImage("src/assets/guessr/galar.webp", 940), localImage("public/geo/maps/world-thumb.webp", 336)]);
  return ogCard({
    eyebrow: "PokéGuessr · new daily game",
    title: ["Where in the", ["world is this?", C.green]],
    subtitle: "GeoGuessr for Pokémon: real in-game screenshots of every region, Kanto to Paldea. A new daily game every day.",
    accent: C.green,
    visual: <ScreenshotVisual src={shot} map={map} pin={null} />,
    footer: "Drop a pin · up to 25,000 points →",
  });
}
