import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { TIMELINE } from "@/lib/timeline/data";
import { localTimeline } from "@/lib/timeline/localize";
import { entryPath } from "@/lib/timeline/deeplink";
import { dateRows, firstRelease, formatDate, isCompact } from "@/lib/timeline/types";
import { TimelinePage } from "@/components/timeline/TimelinePage";
import { getLocale, serverT } from "@/i18n/server";
import timelineNs from "@/messages/timeline";
import pageNs from "@/messages/timeline-page";

/**
 * One moment's own page, /pokedex/timeline/<id>: the share link for an
 * entry. It opens the 3D timeline at the entry with its panel open, and
 * has its own title, description and preview card.
 */

/**
 * Prerendered for every entry with a full card; the TCG lane's compact set
 * entries render on first request and are cached from then on. An id that
 * is not an entry is a 404.
 */
export const dynamicParams = true;

export function generateStaticParams() {
  return TIMELINE.filter((e) => !isCompact(e)).map((e) => ({ event: e.id }));
}

/** The entry in the page's language. */
async function find(params: Promise<{ event: string }>) {
  const { event } = await params;
  return localTimeline(getLocale()).find((e) => e.id === event);
}

export async function generateMetadata({ params }: { params: Promise<{ event: string }> }): Promise<Metadata> {
  const e = await find(params);
  if (!e) return {};
  const t = serverT(pageNs);
  const tl = serverT(timelineNs);
  const first = firstRelease(e);
  const when = dateRows(e).map((r) => t("dateRow", { label: tl(`dates.${r.label}`), date: formatDate(r.date, t.locale) })).join(t("dateJoin"));
  // Japanese runs its sentences together.
  const gap = t.locale === "ja" ? "" : " ";
  const description = `${t("eventWhen", { title: e.title, lane: tl(`lanes.${e.lane}`), platform: e.platform, when })}${e.note ? `${gap}${e.note}` : ""}${gap}${t("eventFly")}`;
  return pageMetadata({
    title: t("eventTitle", { title: e.title, year: first.date.slice(0, 4) }),
    description: description.length > 300 ? `${description.slice(0, 297)}…` : description,
    path: entryPath(e.id),
  });
}

export default async function Page({ params }: { params: Promise<{ event: string }> }) {
  const e = await find(params);
  if (!e) notFound();
  return <TimelinePage focus={e} />;
}
