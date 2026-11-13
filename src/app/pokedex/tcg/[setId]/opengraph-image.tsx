import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { tcgSetCard } from "@/lib/og/tcg";
import { getSet } from "@/lib/tcg/api";

/** Share card for a TCG set: its logo on the site's card. Drawn on first request and cached from then on. */

export const alt = "A Pokémon TCG set on PokéIQ: its card list and prices";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 86400;

export default async function Image({ params }: { params: Promise<{ setId: string }> }) {
  return tcgSetCard(await getSet((await params).setId).catch(() => null));
}
