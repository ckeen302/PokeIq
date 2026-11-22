import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { presetCardImage } from "@/lib/og/mass-battle-cards";
import { DEFAULT_PRESET } from "@/lib/mass-battle/presets";
import { ogT } from "@/lib/og/i18n";

/** Share card for Pokémon Mass Battle: Magikarp against Arceus, and the answer. */

export const alt = "Pokémon Mass Battle on PokéIQ: how many Magikarp does it take to beat Arceus?";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params?: unknown }) {
  return presetCardImage(DEFAULT_PRESET.id, await ogT(props));
}
