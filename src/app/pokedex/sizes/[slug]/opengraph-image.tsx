import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { sizesCard, sizesItemCard } from "@/lib/og/sizes";
import { SIZE_BY_KEY } from "@/lib/sizes/data";
import { DEFAULT_PRESET, PRESET_BY_ID } from "@/lib/sizes/presets";

/** Share card for a lineup or a Pokémon's size page. Drawn on first request and cached from then on. */

export const alt = "Pokémon to scale on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const preset = PRESET_BY_ID.get(slug);
  if (preset) return sizesCard(preset);
  const item = SIZE_BY_KEY.get(slug);
  return item && item.kind !== "ref" ? sizesItemCard(item) : sizesCard(DEFAULT_PRESET);
}
