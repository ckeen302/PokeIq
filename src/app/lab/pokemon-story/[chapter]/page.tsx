import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { POKEMON_STORY_LIVE } from "@/lib/lab";
import { CHAPTERS, chapterById } from "@/lib/pokemon-story/data";
import { chapterPath } from "@/lib/pokemon-story/deeplink";
import { StoryPage } from "@/components/pokemon-story/StoryPage";
import { StoryFilm } from "@/components/pokemon-story/StoryFilm";
import { getLocale, serverT } from "@/i18n/server";
import { localStory } from "@/lib/pokemon-story/i18n";
import storyNs from "@/messages/pokemon-story";

/** /lab/pokemon-story/<chapter>: the film opened on that chapter, over its own text and sources. Prerendered; anything else is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return CHAPTERS.map((c) => ({ chapter: c.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ chapter: string }> }): Promise<Metadata> {
  const id = (await params).chapter;
  if (!chapterById(id)) return {};
  const t = serverT(storyNs);
  const c = localStory(getLocale()).chapters.find((x) => x.id === id)!;
  return pageMetadata({
    title: t("meta.chapterTitle", { title: c.title, when: c.when }),
    description: t("meta.chapterDescription", { summary: c.summary, numeral: c.numeral }),
    path: chapterPath(c.id),
    socialTitle: t("meta.chapterSocial", { title: c.title }),
    noindex: !POKEMON_STORY_LIVE,
  });
}

export default async function Page({ params }: { params: Promise<{ chapter: string }> }) {
  const c = chapterById((await params).chapter);
  if (!c) notFound();
  return <StoryPage focus={c} film={(text, story) => <StoryFilm initialChapter={c.id} story={story}>{text}</StoryFilm>} />;
}
