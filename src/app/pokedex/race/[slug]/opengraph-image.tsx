import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { racePresetCard } from "@/lib/og/race";
import { PRESETS, PRESET_BY_ID } from "@/lib/race/presets";
import { HUB_PRESET } from "@/lib/race/deeplink";

/** Share card for a preset race. */

export const alt = "A Pokémon race on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return PRESETS.filter((p) => p.id !== HUB_PRESET).map((p) => ({ slug: p.id }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  return racePresetCard(PRESET_BY_ID.get((await params).slug));
}
