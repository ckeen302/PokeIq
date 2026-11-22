import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { POKEMON_STORY_LIVE } from "@/lib/lab";
import { STORY_PATH } from "@/lib/pokemon-story/deeplink";
import { StoryPage } from "@/components/pokemon-story/StoryPage";
import { StoryFilm } from "@/components/pokemon-story/StoryFilm";
import { serverT } from "@/i18n/server";
import storyNs from "@/messages/pokemon-story";

export function generateMetadata(): Metadata {
  const t = serverT(storyNs);
  return pageMetadata({
    title: t("meta.title"),
    description: t("meta.description"),
    path: STORY_PATH,
    socialTitle: t("meta.socialTitle"),
    noindex: !POKEMON_STORY_LIVE,
  });
}

export default function Page() {
  return <StoryPage film={(text, story) => <StoryFilm initialChapter={null} story={story}>{text}</StoryFilm>} />;
}
