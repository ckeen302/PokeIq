import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { sizesCard } from "@/lib/og/sizes";
import { DEFAULT_PRESET } from "@/lib/sizes/presets";

/** Share card for Pokémon Sizes. */

export const alt = "Every Pokémon to scale, from the smallest to Eternamax Eternatus, on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return sizesCard(DEFAULT_PRESET);
}
