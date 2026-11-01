import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { TIMELINE } from "@/lib/timeline/data";
import { entryPath } from "@/lib/timeline/deeplink";
import { LANE_BY_ID, dateRows, formatDate } from "@/lib/timeline/types";
import { TimelinePage } from "@/components/timeline/TimelinePage";

/**
 * One moment's own page, /pokedex/timeline/<id>: the share link for an
 * entry. It opens the 3D timeline at the entry with its panel open, and
 * has its own title, description and preview card.
 */

export const dynamicParams = false;

export function generateStaticParams() {
  return TIMELINE.map((e) => ({ event: e.id }));
}

async function find(params: Promise<{ event: string }>) {
  const { event } = await params;
  return TIMELINE.find((e) => e.id === event);
}

export async function generateMetadata({ params }: { params: Promise<{ event: string }> }): Promise<Metadata> {
  const e = await find(params);
  if (!e) return {};
  const first = dateRows(e)[0];
  const when = dateRows(e).map((r) => `${r.label} ${formatDate(r.date)}`).join(", ");
  const description = `${e.title} (${LANE_BY_ID[e.lane].label}, ${e.platform}): ${when}.${e.note ? ` ${e.note}` : ""} Fly to it on the 3D Pokémon Timeline.`;
  return pageMetadata({
    title: `${e.title} (${first.date.slice(0, 4)}) — Pokémon Timeline`,
    description: description.length > 300 ? `${description.slice(0, 297)}…` : description,
    path: entryPath(e.id),
  });
}

export default async function Page({ params }: { params: Promise<{ event: string }> }) {
  const e = await find(params);
  if (!e) notFound();
  return <TimelinePage focus={e} />;
}
