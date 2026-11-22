import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { theoriesCard, theoryCaseCard } from "@/lib/og/theories";
import { CASE_BY_SLUG } from "@/lib/theories/data";
import { ogT } from "@/lib/og/i18n";

/** Share card for one case file: its photos and its verdict. */

export const alt = "A Pokémon theory's case file on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image(props: { params: Promise<{ slug: string }> }) {
  const t = await ogT(props);
  const c = CASE_BY_SLUG.get((await props.params).slug);
  return c ? theoryCaseCard(c, t) : theoriesCard(t);
}
