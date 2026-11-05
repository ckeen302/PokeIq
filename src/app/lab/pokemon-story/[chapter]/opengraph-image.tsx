import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { storyChapterCard } from "@/lib/og/pokemon-story";
import { CHAPTERS, chapterById } from "@/lib/pokemon-story/data";

/** Each chapter's share card: a still of its scene, its title and when it happened. */

export const alt = "A chapter of The Story of Pokémon on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return CHAPTERS.map((c) => ({ chapter: c.id }));
}

export default async function Image({ params }: { params: Promise<{ chapter: string }> }) {
  const c = chapterById((await params).chapter) ?? CHAPTERS[0];
  return storyChapterCard(c);
}
