import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { chapterPath, HISTORY_PATH } from "@/lib/world-history/deeplink";
import { localHistory } from "@/lib/world-history/i18n";
import type { Chapter } from "@/lib/world-history/types";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale } from "@/i18n/server";
import { localizePath } from "@/i18n/paths";
import filmNs from "@/messages/world-history-film";
import videoNs from "@/messages/film-video";
import { HistoryText } from "./HistoryText";
import { WorldHistoryExperience } from "./WorldHistoryExperience";
import { historySerif } from "./fonts";
import { WH_TEXT_CSS } from "./wh-css";

/**
 * /lab/world-history and each chapter's page: the film (a scroll-driven
 * museum in 3D, client-only) over the server-rendered history with its
 * sources, which is the page for search engines, reduced motion and
 * browsers without WebGL. In another language the text comes from that
 * language's content file, and the film gets the translated history (an
 * English film reads its own data).
 */
export function WorldHistoryPage({ focus }: { focus?: Chapter }) {
  const locale = getLocale();
  const HISTORY = localHistory(locale);
  const CHAPTERS = HISTORY.chapters;
  const here = focus && (CHAPTERS.find((c) => c.id === focus.id) ?? focus);
  const abs = (path: string) => `${SITE_URL}${localizePath(path, locale)}`;
  const url = abs(here ? chapterPath(here.id) : HISTORY_PATH);
  const ld = here
    ? {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: `${here.title}: ${here.region} (${HISTORY.title})`,
        description: here.summary,
        url,
        isPartOf: { "@type": "CreativeWork", name: HISTORY.title, url: abs(HISTORY_PATH) },
      }
    : {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: HISTORY.title,
        description: HISTORY.tagline,
        url,
        numberOfItems: CHAPTERS.length,
        itemListElement: CHAPTERS.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: `${c.region}: ${c.title}`, url: abs(chapterPath(c.id)) })),
      };
  return (
    <div className={`${historySerif.variable} mx-auto max-w-4xl`}>
      <style>{WH_TEXT_CSS}</style>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <ClientMessages namespaces={[filmNs, videoNs]}>
        <WorldHistoryExperience initialChapter={here?.id ?? null} localized={locale === "en" ? undefined : HISTORY}>
          <HistoryText focus={here} history={HISTORY} />
        </WorldHistoryExperience>
      </ClientMessages>
    </div>
  );
}
