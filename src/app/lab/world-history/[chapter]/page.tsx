import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { WORLD_HISTORY_LIVE } from "@/lib/lab";
import { CHAPTERS, chapterById } from "@/lib/world-history/data";
import { chapterPath } from "@/lib/world-history/deeplink";
import { WorldHistoryPage } from "@/components/world-history/WorldHistoryPage";

/** /lab/world-history/<chapter>: the film opened on that chapter, over its own text and sources. Prerendered; anything else is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return CHAPTERS.map((c) => ({ chapter: c.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ chapter: string }> }): Promise<Metadata> {
  const c = chapterById((await params).chapter);
  if (!c) return {};
  return pageMetadata({
    title: `${c.title}: ${c.region}'s history (${c.when})`,
    description: `${c.summary} Chapter ${c.numeral} of The History of the Pokémon World, a 3D museum of the in-universe story, with every line sourced to the games.`,
    path: chapterPath(c.id),
    socialTitle: `${c.title} · The History of the Pokémon World`,
    noindex: !WORLD_HISTORY_LIVE,
  });
}

export default async function Page({ params }: { params: Promise<{ chapter: string }> }) {
  const c = chapterById((await params).chapter);
  if (!c) notFound();
  return <WorldHistoryPage focus={c} />;
}
