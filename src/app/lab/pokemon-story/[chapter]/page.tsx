import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { POKEMON_STORY_LIVE } from "@/lib/lab";
import { CHAPTERS, chapterById } from "@/lib/pokemon-story/data";
import { chapterPath } from "@/lib/pokemon-story/deeplink";
import { StoryPage } from "@/components/pokemon-story/StoryPage";
import { StoryFilm } from "@/components/pokemon-story/StoryFilm";

/** /lab/pokemon-story/<chapter>: the film opened on that chapter, over its own text and sources. Prerendered; anything else is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return CHAPTERS.map((c) => ({ chapter: c.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ chapter: string }> }): Promise<Metadata> {
  const c = chapterById((await params).chapter);
  if (!c) return {};
  return pageMetadata({
    title: `${c.title} (${c.when}): The Story of Pokémon`,
    description: `${c.summary} Chapter ${c.numeral} of The Story of Pokémon, the real history of the franchise as a 3D film, with every line sourced.`,
    path: chapterPath(c.id),
    socialTitle: `${c.title} · The Story of Pokémon`,
    noindex: !POKEMON_STORY_LIVE,
  });
}

export default async function Page({ params }: { params: Promise<{ chapter: string }> }) {
  const c = chapterById((await params).chapter);
  if (!c) notFound();
  return <StoryPage focus={c} film={(text) => <StoryFilm initialChapter={c.id}>{text}</StoryFilm>} />;
}
