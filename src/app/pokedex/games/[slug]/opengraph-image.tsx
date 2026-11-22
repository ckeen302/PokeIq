import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { videoGameCard } from "@/lib/og/video-games";
import { VIDEO_GAMES, getVideoGame } from "@/lib/dex/video-games";
import { ogT } from "@/lib/og/i18n";

/** Share card for one game: its box art on the site's card. */

export const alt = "A Pokémon game on the PokéIQ Pokédex: its box art and details";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return VIDEO_GAMES.map((g) => ({ slug: g.slug }));
}

export default async function Image(props: { params: Promise<{ slug: string }> }) {
  return videoGameCard(getVideoGame((await props.params).slug), await ogT(props));
}
