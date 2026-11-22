import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { presetCardImage } from "@/lib/og/mass-battle-cards";
import { PRESETS } from "@/lib/mass-battle/presets";
import { ogT } from "@/lib/og/i18n";

/** A ready-made battle's share card: both armies and the answer or result. */

export const alt = "A Pokémon mass battle on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return PRESETS.map((p) => ({ preset: p.id }));
}

export default async function Image(props: { params: Promise<{ preset: string }> }) {
  return presetCardImage((await props.params).preset, await ogT(props));
}
