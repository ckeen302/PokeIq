import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { sizesCard } from "@/lib/og/sizes";
import { DEFAULT_PRESET } from "@/lib/sizes/presets";
import { ogT } from "@/lib/og/i18n";

/** Share card for Pokémon Sizes. */

export const alt = "Every Pokémon to scale, from the smallest to Eternamax Eternatus, on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  return sizesCard(DEFAULT_PRESET, await ogT(props));
}
