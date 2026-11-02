import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { presetCardImage } from "@/lib/og/mass-battle-cards";
import { PRESETS } from "@/lib/mass-battle/presets";

/** A ready-made battle's share card: both armies and the answer or result. */

export const alt = "A Pokémon mass battle on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return PRESETS.map((p) => ({ preset: p.id }));
}

export default async function Image({ params }: { params: Promise<{ preset: string }> }) {
  return presetCardImage((await params).preset);
}
