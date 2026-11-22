import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { WORLD_HISTORY_LIVE } from "@/lib/lab";
import { CHAPTERS, chapterById } from "@/lib/world-history/data";
import { chapterPath } from "@/lib/world-history/deeplink";
import { WorldHistoryPage } from "@/components/world-history/WorldHistoryPage";
import { getLocale, serverT } from "@/i18n/server";
import { localHistory } from "@/lib/world-history/i18n";
import historyNs from "@/messages/world-history";

/** /lab/world-history/<chapter>: the film opened on that chapter, over its own text and sources. Prerendered; anything else is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return CHAPTERS.map((c) => ({ chapter: c.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ chapter: string }> }): Promise<Metadata> {
  const id = (await params).chapter;
  if (!chapterById(id)) return {};
  const t = serverT(historyNs);
  const c = localHistory(getLocale()).chapters.find((x) => x.id === id)!;
  return pageMetadata({
    title: t("meta.chapterTitle", { title: c.title, region: c.region, when: c.when }),
    description: t("meta.chapterDescription", { summary: c.summary, numeral: c.numeral }),
    path: chapterPath(c.id),
    socialTitle: t("meta.chapterSocial", { title: c.title }),
    noindex: !WORLD_HISTORY_LIVE,
  });
}

export default async function Page({ params }: { params: Promise<{ chapter: string }> }) {
  const c = chapterById((await params).chapter);
  if (!c) notFound();
  return <WorldHistoryPage focus={c} />;
}
