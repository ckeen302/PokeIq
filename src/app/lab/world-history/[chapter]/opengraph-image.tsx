import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { historyChapterCard } from "@/lib/og/world-history";
import { CHAPTERS, chapterById } from "@/lib/world-history/data";
import { ogT } from "@/lib/og/i18n";

/** Each chapter's share card: its exhibit, title and when it happened. */

export const alt = "A chapter of The History of the Pokémon World on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return CHAPTERS.map((c) => ({ chapter: c.id }));
}

export default async function Image(props: { params: Promise<{ chapter: string }> }) {
  const c = chapterById((await props.params).chapter) ?? CHAPTERS[0];
  return historyChapterCard(c, await ogT(props));
}
