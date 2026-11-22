import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { chapterPath, STORY_PATH } from "@/lib/pokemon-story/deeplink";
import { localStory } from "@/lib/pokemon-story/i18n";
import type { Chapter, Story } from "@/lib/pokemon-story/types";
import { historySerif } from "@/components/world-history/fonts";
import { WH_TEXT_CSS } from "@/components/world-history/wh-css";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale } from "@/i18n/server";
import { localizePath } from "@/i18n/paths";
import filmNs from "@/messages/pokemon-story-film";
import videoNs from "@/messages/film-video";
import { StoryText } from "./StoryText";

/**
 * /lab/pokemon-story and each chapter's page: the film (scroll-driven, in
 * 3D, client-only) over the server-rendered story with its sources, which
 * is the page for search engines, reduced motion and browsers without WebGL.
 * In another language the text comes from that language's content file, and
 * the film gets the translated story (an English film reads its own data).
 */
export function StoryPage({ focus, film }: { focus?: Chapter; film?: (text: React.ReactNode, story: Story | undefined) => React.ReactNode }) {
  const locale = getLocale();
  const STORY = localStory(locale);
  const CHAPTERS = STORY.chapters;
  const here = focus && (CHAPTERS.find((c) => c.id === focus.id) ?? focus);
  const abs = (path: string) => `${SITE_URL}${localizePath(path, locale)}`;
  const url = abs(here ? chapterPath(here.id) : STORY_PATH);
  const ld = here
    ? {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: `${here.title} (${STORY.title})`,
        description: here.summary,
        url,
        isPartOf: { "@type": "CreativeWork", name: STORY.title, url: abs(STORY_PATH) },
      }
    : {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: STORY.title,
        description: STORY.tagline,
        url,
        itemListElement: CHAPTERS.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.title, url: abs(chapterPath(c.id)) })),
      };
  const text = <StoryText focus={here} story={STORY} />;
  return (
    <div className={`${historySerif.variable} mx-auto max-w-4xl`}>
      <style>{WH_TEXT_CSS}</style>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      {film ? <ClientMessages namespaces={[filmNs, videoNs]}>{film(text, locale === "en" ? undefined : STORY)}</ClientMessages> : text}
    </div>
  );
}
