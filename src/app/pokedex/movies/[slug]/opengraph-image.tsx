import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { movieCard } from "@/lib/og/movies";
import { MOVIES, getMovie } from "@/lib/movies/data";

/** Share card for a Pokémon film: its poster on the site's card. */

export const alt = "A Pokémon movie in the PokéIQ Pokédex: its poster, featured Pokémon and characters";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return MOVIES.map((m) => ({ slug: m.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  return movieCard(getMovie((await params).slug));
}
