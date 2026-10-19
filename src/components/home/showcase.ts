import "server-only";
import type { StaticImageData } from "next/image";
import alola from "@/assets/guessr/alola.webp";
import galar from "@/assets/guessr/galar.webp";
import hoenn from "@/assets/guessr/hoenn.webp";
import johto from "@/assets/guessr/johto.webp";
import kalos from "@/assets/guessr/kalos.webp";
import kanto from "@/assets/guessr/kanto.webp";
import paldea from "@/assets/guessr/paldea.webp";
import sinnoh from "@/assets/guessr/sinnoh.webp";
import unova from "@/assets/guessr/unova.webp";
import { geoWorldPin } from "@/lib/server/geo";
import type { ShowcaseSlide } from "./GuessrShowcase";

/**
 * One real PokéGuessr view per region for the title screen: each region's
 * first town (the same places /guessr previews, so no round is given away),
 * from games across the series. The first is the page's hero image.
 */
const VIEWS: { image: StaticImageData; region: string; town: string }[] = [
  { image: paldea, region: "Paldea", town: "Cabo Poco" }, // Scarlet / Violet
  { image: kanto, region: "Kanto", town: "Pallet Town" }, // Gold / Silver / Crystal
  { image: galar, region: "Galar", town: "Postwick" }, // Sword / Shield
  { image: hoenn, region: "Hoenn", town: "Littleroot Town" }, // Omega Ruby / Alpha Sapphire
  { image: johto, region: "Johto", town: "New Bark Town" }, // HeartGold / SoulSilver
  { image: sinnoh, region: "Sinnoh", town: "Twinleaf Town" }, // Brilliant Diamond / Shining Pearl
  { image: kalos, region: "Kalos", town: "Vaniville Town" }, // X / Y
  { image: unova, region: "Unova", town: "Nuvema Town" }, // Black 2 / White 2
  { image: alola, region: "Alola", town: "Iki Town" }, // Ultra Sun / Ultra Moon
];

export function showcaseSlides(): ShowcaseSlide[] {
  return VIEWS.map(({ image, region, town }) => ({ image, pin: geoWorldPin(region, town) }));
}

/** The first view, for the home page's link-preview card. */
export const SHOWCASE_HERO = "src/assets/guessr/paldea.webp";

/** A small copy of the world map (the full one is 5850 px wide). */
export const WORLD_THUMB = { src: "/geo/maps/world-thumb.webp", width: 960, height: 421 };
