import { C, OG_CONTENT_TYPE, OG_SIZE, ScreenshotVisual, localImage, ogCard } from "@/lib/og/card";
import { geoWorldPin } from "@/lib/server/geo";

/** The site's share card: what PokéIQ is, over a real PokéGuessr view. */

export const alt = "PokéIQ: PokéGuessr, Pokédle, Pokémon battles and quizzes";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  const [shot, map] = await Promise.all([localImage("src/assets/guessr/paldea.webp", 940), localImage("public/geo/maps/world-thumb.webp", 336)]);
  return ogCard({
    eyebrow: "Free Pokémon games",
    title: [["Guess the place.", C.green], ["Name the Pokémon.", C.violet], ["Win the battle.", C.pink]],
    titleSize: 56,
    subtitle: "No sign-up. Play in your browser.",
    accent: C.green,
    visual: <ScreenshotVisual src={shot} map={map} pin={geoWorldPin("Paldea", "Cabo Poco")} />,
    chips: ["PokéGuessr", "Pokédle", "Battles", "Battle Lab", "Quizzes"],
  });
}
