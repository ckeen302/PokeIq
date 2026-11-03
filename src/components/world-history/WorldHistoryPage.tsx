import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { CHAPTERS, HISTORY } from "@/lib/world-history/data";
import { chapterPath, HISTORY_PATH } from "@/lib/world-history/deeplink";
import type { Chapter } from "@/lib/world-history/types";
import { HistoryText } from "./HistoryText";
import { WorldHistoryExperience } from "./WorldHistoryExperience";
import { historySerif } from "./fonts";
import { WH_TEXT_CSS } from "./wh-css";

/**
 * /lab/world-history and each chapter's page: the film (a scroll-driven
 * museum in 3D, client-only) over the server-rendered history with its
 * sources, which is the page for search engines, reduced motion and
 * browsers without WebGL.
 */
export function WorldHistoryPage({ focus }: { focus?: Chapter }) {
  const url = `${SITE_URL}${focus ? chapterPath(focus.id) : HISTORY_PATH}`;
  const ld = focus
    ? {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: `${focus.title}: ${focus.region} (${HISTORY.title})`,
        description: focus.summary,
        url,
        isPartOf: { "@type": "CreativeWork", name: HISTORY.title, url: `${SITE_URL}${HISTORY_PATH}` },
      }
    : {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: HISTORY.title,
        description: HISTORY.tagline,
        url,
        numberOfItems: CHAPTERS.length,
        itemListElement: CHAPTERS.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: `${c.region}: ${c.title}`, url: `${SITE_URL}${chapterPath(c.id)}` })),
      };
  return (
    <div className={`${historySerif.variable} mx-auto max-w-4xl`}>
      <style>{WH_TEXT_CSS}</style>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <WorldHistoryExperience initialChapter={focus?.id ?? null}>
        <HistoryText focus={focus} />
      </WorldHistoryExperience>
    </div>
  );
}
