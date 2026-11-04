import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { CHAPTERS, STORY } from "@/lib/pokemon-story/data";
import { chapterPath, STORY_PATH } from "@/lib/pokemon-story/deeplink";
import type { Chapter } from "@/lib/pokemon-story/types";
import { historySerif } from "@/components/world-history/fonts";
import { WH_TEXT_CSS } from "@/components/world-history/wh-css";
import { StoryText } from "./StoryText";

/**
 * /lab/pokemon-story and each chapter's page: the film (scroll-driven, in
 * 3D, client-only) over the server-rendered story with its sources, which
 * is the page for search engines, reduced motion and browsers without WebGL.
 */
export function StoryPage({ focus, film }: { focus?: Chapter; film?: (text: React.ReactNode) => React.ReactNode }) {
  const url = `${SITE_URL}${focus ? chapterPath(focus.id) : STORY_PATH}`;
  const ld = focus
    ? {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: `${focus.title} (${STORY.title})`,
        description: focus.summary,
        url,
        isPartOf: { "@type": "CreativeWork", name: STORY.title, url: `${SITE_URL}${STORY_PATH}` },
      }
    : {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: STORY.title,
        description: STORY.tagline,
        url,
        itemListElement: CHAPTERS.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.title, url: `${SITE_URL}${chapterPath(c.id)}` })),
      };
  const text = <StoryText focus={focus} />;
  return (
    <div className={`${historySerif.variable} mx-auto max-w-4xl`}>
      <style>{WH_TEXT_CSS}</style>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      {film ? film(text) : text}
    </div>
  );
}
