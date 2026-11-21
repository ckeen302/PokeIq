import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { theoriesCard } from "@/lib/og/theories";

/** Share card for the Theories tab, the case files. */

export const alt = "The case files: Pokémon theories, urban legends and beta myths on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return theoriesCard();
}
