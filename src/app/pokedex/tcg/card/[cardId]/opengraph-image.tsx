import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { tcgCardCard } from "@/lib/og/tcg";
import { getCard } from "@/lib/tcg/api";

/** Share card for a TCG card: its scan on the site's card. Drawn on first request and cached from then on. */

export const alt = "A Pokémon card on PokéIQ: its scan and market prices";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 86400;

export default async function Image({ params }: { params: Promise<{ cardId: string }> }) {
  return tcgCardCard(await getCard((await params).cardId).catch(() => null));
}
