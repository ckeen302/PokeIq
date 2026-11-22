import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { tcgCardCard } from "@/lib/og/tcg";
import { getCard } from "@/lib/tcg/api";
import { ogT } from "@/lib/og/i18n";

/** Share card for a TCG card: its scan on the site's card. Drawn on first request and cached from then on. */

export const alt = "A Pokémon card on PokéIQ: its scan and market prices";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 86400;

export default async function Image(props: { params: Promise<{ cardId: string }> }) {
  return tcgCardCard(await getCard((await props.params).cardId).catch(() => null), await ogT(props));
}
